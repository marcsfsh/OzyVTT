# Area 3 re-verification — what moved since the plan was written

**Verified at `2fd84fc`** (branch `claude/feature-implementations-intake-c5eyu1`), 2026-08-08.
The Area 3 plan in `feature-implementations-plan.md` was written at `c2f3b6b` (2026-08-07); **74
commits landed between** — all of Area 1 and Area 2 Wave 0.

**This document does not re-plan Area 3.** It says what a re-read of HEAD changes and what it does
not. Where this file, the plan, or `known-bugs.md` disagree with the code, **the code wins** and the
disagreement is recorded here as a defect.

---

## The headline

**Almost nothing moved, and the reason is measurable.** Across every file Area 3 touches, exactly
one changed since intake:

```
git diff --stat c2f3b6b..HEAD -- \
  apps/client/src/scene apps/client/src/encounter apps/client/src/styles.css apps/client/src/dice \
  packages/ui/src/styles apps/server/src/replay-launch.ts apps/server/src/scenes.ts \
  apps/client/src/replay apps/client/src/codex/MapSurface.tsx
  → (empty)

git diff --stat c2f3b6b..HEAD -- \
  apps/server/src/hit-points.ts apps/server/src/saving-throws.ts apps/server/src/reactions.ts \
  apps/server/src/action-resolution.ts packages/rules-5e/src/combat.ts
  → apps/server/src/action-resolution.ts | 111 +++++++++-----------
```

So: **`action-resolution.ts` moved. Everything else in Area 3 territory is byte-identical to
intake.** Six issues are untouched; four moved, and three of those moved only in line numbers.

**The brief's premise that "the round-2 files have been touched since" is wrong** — they have not.
That is a finding in the brief's favour: every `4c`/`4c.1`/`4d`/`4e`/`4g`/`4h` line citation in the
plan still resolves to the text it claims, and I confirmed each one below rather than trusting it.

---

## Issue-by-issue

| Issue | Status at HEAD | Size |
|---|---|---|
| `4a` typed damage | **Moved — grew.** Four gaps survive; a **fifth** opened (`choiceOverrides`) | **L**, estimated (was L) |
| `4b` editable save damage | **Unchanged in substance; all line cites moved.** One new precedent found | **M**, estimated |
| `4c` docked wheel | **Unchanged.** Reproduces; every cite exact | **S**, measured |
| `4c.1` border bleed | **Unchanged.** Reproduces; cite off by one line | **S**, measured |
| `4d` adv/disadv height | **Unchanged.** Cite exact | **S**, measured |
| `4e` recent-rolls x-scroll | **Unchanged.** Cites exact. Existing audit is blind to it | **S**, measured |
| `4f` pinch-to-zoom | **Unchanged.** Reference impl intact, gesture machine unchanged | **M**, estimated |
| `4g` add-to-fight list | **Unchanged.** Cites exact; one plan path is wrong | **M**, estimated |
| `4h` map jump | **Unchanged in CSS. The *test* half moved** — there is no home for it | **S** css (measured) + **M** harness (estimated) |
| `4i` replay launch | **Unchanged.** Leak and arithmetic confirmed exactly | **L**, estimated |

Sizes are carried from the plan except `4a` (grew by one gap) and `4h` (split). None was re-measured
from scratch; the four marked **measured** are one-file CSS edits whose exact target line I read.

---

## `4a` — the re-verification

The plan's dated correction named four gaps and said "four real gaps, and only four." **All four
survive at HEAD. There are now five.**

**Gap 1 — flat `damage-reduction` is unread. SURVIVES.**
`character-build.ts:304` still carries `"damage-reduction": "unread"` in
`CARRIER_RIDER_DISPOSITION`. (Plan cited `:206`; the line moved, the fact did not.) No file under
`apps/server/src` consumes the rider. Unchanged.

**Gap 2 — vulnerability has exactly one channel. SURVIVES, verbatim.**
`hit-points.ts` passes `vulnerabilities: innate.vulnerabilities` and nothing else.
`effects.ts:235 effectDamageDefenses` returns `{ resistances, sources }` — no vulnerabilities
branch. `InterpretedFeatures` (`character-build.ts:244-245`) declares `damageResistances` and
`damageImmunities` and **no** `damageVulnerabilities`. **A player character still cannot be
vulnerable to anything, and no effect or item can grant vulnerability.**

**Gap 3 — three of six call sites discard `application.parts`. SURVIVES, and the cites are exact.**
`applyDamageDetailed` has exactly six external call sites at HEAD:

| Site | Narrates the adjustment? |
|---|---|
| `game-operations.ts:1053` | yes |
| `player-damage.ts:64` | yes |
| `player-damage.ts:86` | yes |
| `saving-throws.ts:306` | **no** — `appliedDamage = outcome.application.totalApplied` |
| `reactions.ts:116` | **no** — same discard |
| `reactions.ts:131` | **no** — same discard |

(`hit-points.ts:218` is the internal `applyDamage` wrapper, not a seventh entry point.) The plan's
insertion point for `4b` is also still live: `outcomeParts` is derived at `saving-throws.ts:286-288`,
*before* the application at `:305`.

**Gap 4 — the untyped manual path (D7). SURVIVES, and its line numbers did not even move**
(`hit-points.ts:117-120`). **But its shape did change, and in `4a`'s favour.** The GM is no longer
the only untyped door: `ActionRunner.tsx:90-93,157-158` already carries a typed damage **override**
on the attack path, and it deliberately drops `parts` when the number is amended
(`...(useOverride ? {} : { parts })`), routing the amended value through the same defence-skipping
branch. So the "amend loses the damage type" behaviour D7 describes exists in **two** places, not
one, and a single optional-type field on the damage entry closes both. **This ties `4b` to `4a`
gap 4 more tightly than the plan says** — see the order below.

**Gap 5 — NEW. `choiceOverrides` is written, projected, cleared, and read by nobody at damage time.**
This is ruling A's unfinished half (`ef54720`, Area 1) and it lands squarely in `4a`'s territory.

- Written: `game-operations.ts:1890` (`actor.rechoose`).
- Cleared: `rests.ts:87,99`.
- Projected: `projections.ts:283`, gated on `resourcesVisible`.
- Read: `choice-overrides.ts` exports `replaceableOffers`, imported **only** by
  `game-operations.ts:18` — i.e. only to answer *what may be re-chosen*, never *what was chosen*.
- `hit-points.ts` collects defences from four sources (definition RVI, `effectDamageDefenses`,
  `deriveEquipment`, Petrified/Underwater) and **`choiceOverrides` is not one of them.**

The record standing on it is the Warlock's **Fiendish Resilience**
(`content-srd-5.2.1/scripts/class-mechanics/warlock.ts:295-306`): twelve inline options, each
carrying `grants: { damageResistances: [id] }`, re-chosen on a short rest. A Warlock can pick fire
resistance, see it on the sheet, see it in the projection — and take full fire damage. Same class of
defect as gaps 1 and 2: **a field exists, a control exists, no reader exists.**

`4a` must add `choiceOverrides` as a fifth defence source in `hit-points.ts`, resolving each override
to its option's `grants.damageResistances` through the content view.

---

## The canonical damage-type source

**Confirmed: the server reads `DAMAGE_TYPE_IDS` nowhere at HEAD.** Its only importers are
`apps/client/src/homebrew/schema.ts:132`, `apps/client/src/homebrew/useSchemaContext.ts:134`, and two
tests. It is still 13 frozen slugs at `packages/content-srd-5.2.1/src/enums.ts:26`, pinned by
`test/enums.test.ts:28-29`.

**The specifier both halves must use is `@vtt/content-srd-5.2.1/schemas`** — that is what
`schema.ts` and `useSchemaContext.ts` already import (`schemas.ts:45` does `export * from
"./enums.js"`), and both `apps/client` and `apps/server` declare `@vtt/content-srd-5.2.1` as a
dependency.

**The file where `4a` should import it is `apps/server/src/hit-points.ts`** — not
`packages/rules-5e/src/combat.ts`, and this is a correction to the plan. `content-srd-5.2.1`
**depends on** `@vtt/rules-5e` (`content-srd-5.2.1/package.json`), so `rules-5e` importing
`DAMAGE_TYPE_IDS` would be a dependency cycle. `rules-5e` has no dependencies at all today; keep it
that way. The pure maths stays in `combat.ts`; the canonical *list* is consulted at the server layer.

**`normalizeDamageType()` has the same constraint, and the plan's "add it beside `DAMAGE_TYPE_IDS`"
would create the cycle.** The normaliser already exists as a private function —
`packages/rules-5e/src/combat.ts:22`, `trim().toLowerCase()`. **Export it from `rules-5e` and
re-export it from `content-srd-5.2.1`**; both apps depend on both packages, so the editor's write
path and the engine's lookup can share one implementation with the dependency arrow intact.

**One hazard for whoever closes the enum: `"untyped"` is a live 14th value.** It is the fallback type
at `action-resolution.ts:926, 950, 983`, and `build-bundle.ts:391` reports bundled SRD actions that
carry it. It normalises to `"untyped"`, matches no resistance, and takes full damage — correct — but
any assertion of the form "every damage type is one of the 13" will fail against real content.

---

## Dependency note: what `4a` may assume once `3d` lands

`3d` is landing now, out of order, because it gates `4a`. When it does, `4a` may assume:

- **Values authored *through the editor* at the nine sites are canonical slugs from
  `DAMAGE_TYPE_IDS`** — lowercase, hyphen-free, matching `combat.ts`'s normalised form byte for byte.
- **It may NOT assume the field is closed.** The plan's own Area 2 correction is explicit
  (`vocabularies.test.ts:93-105` deliberately pins `kind: "text"`; a GM must still be able to type a
  homebrew type). `DamageTypeIdSchema` stays open. **The engine must keep normalising on read** —
  free text, legacy hand-typed values, imported stat blocks and `"untyped"` all still arrive.
- **It may not assume `3d` normalised anything on write** unless the sibling exports the shared
  `normalizeDamageType`. If the sibling adds it in `enums.ts` rather than re-exporting from
  `rules-5e`, `combat.ts` cannot import it and the two halves will normalise separately — the exact
  drift the shared helper exists to prevent. **Agree on this before `4a` starts.**

---

## What Area 1 changed in encounter territory

`action-resolution.ts` is the one Area 3 file Area 1 touched (+111/−11). Nothing in it changes `4a`'s
or `4b`'s **shape**; it changes their **volume and their line numbers**.

- **`f8ea88e` moved `riderFilters.damageTypes` out of the `action.attack && targets.length === 1`
  branch** to `:809-810`, above the branch. `damage-type-is` now reaches save-only spells.
  → **`known-bugs.md:456-465` is stale and should be deleted.** The commit fixed the code and
  inverted the boundary test (`warlock-sorcerer-wizard.test.ts`, 46 tests pass at HEAD) but left the
  entry, against the file's own rule "when you fix one, delete the entry."
- **Weapon mastery reaches the resolver.** Graze pushes a **typed** entry
  (`:950`, `type: action.damage[0]?.type ?? "untyped"`) into `bonusDamage`, and
  `player-damage.ts:29-34 resolutionDamageParts` folds `bonusDamage` into `parts` — so **Graze
  damage already routes through the typed pipeline correctly.** Sap (`:1058`) applies an effect, not
  damage. No `4a` change needed; more typed surface to test.
- **Extra Attack (`7a6c3aa`), the Monk Unarmed Strike (`532daa0`), and `spellId` on cantrip actions
  (`9eea573`)** all feed the existing `player-damage.ts:64` path, which already narrates. They raise
  the number of damage applications per turn — which is a **`4b` argument**, not a `4a` one: more
  auto-rolled damage the GM cannot amend.
- **`choiceOverrides`** — gap 5 above. The one genuine new `4a` defect.

Line numbers that moved in `action-resolution.ts` (plan → HEAD): damage roll `:886-905` → **`:908-919`**;
`attackTotal` manual door `:821` → **`:842-850`**; `pendingSaves[].proposedDamage` `:1097-1098` →
**`:1148-1149`**.

`4b`'s governing-setting claim **re-verified and holds**: `dice/roll-preference.ts` (`vtt.sheet.rollInput`)
reaches `CharacterSheet.tsx:323,332`, `ActionRunner.tsx:102` (the attack d20 only, `:284-287`),
`EncounterPanel.tsx:600,614,642,727` and `SettingsPage.tsx:161` — and **nothing on the damage roll.**
`save:answer`'s payload (`domain/src/index.ts:1109`, `api-contract:1619`) carries `method`/`total` for
the **save d20** only; there is no damage door.

---

## The four round-2 UI regressions

All four **still reproduce**, and since the files are untouched the plan's archaeology stands. I
re-read each target line:

- **`4h`.** `encounter-map.css:395` still reads
  `.encounter-map-interaction.enlarged .encounter-map-saving { position: absolute; … }` — the float
  is still gated on `.enlarged`, exactly as the plan says. `:388` is still the in-flow
  `.encounter-map-saving { margin: var(--space-2) 0 0; … }` with no reserved height; `:4` is still
  the `flex: 1` column; `:180` still `flex: 1`; `:777` still states the stage's height below 979px.
  **The two-line CSS fix is correct as written.** (Plan typo: the `min-height` precedent
  `.encounter-map-feedback` is at `:396`, not `:389`.)
- **`4c`.** `EncounterMap.tsx:206` is still the correct dock guard — do not touch it.
  `EncounterMap.tsx:726` still puts `scroll-y` on `.encounter-map-dock`;
  `EncounterPanel.tsx:691` still puts it on `.encounter-region`; `encounter-panel.css:222` still has
  `overscroll-behavior: contain`; `encounter-map.css:346` still leaves the docked panel a plain
  block. Two nested ports, one with zero extent, `contain` blocking the chain out. Diagnosis stands.
- **`4c.1` / `4g`.** The shared pseudo rule is at `encounter-panel.css:1500-1528` (plan said
  `1499-1526`). `.encounter-menu::before` and `.row-tools-popover::before` are both in the selector
  list — so the plan's "check `.row-tools-popover` for the same trap" is confirmed, not speculative.
  `EncounterPanel.tsx:1065` still sets `.encounter-menu` `scroll-y` + inline `maxHeight`;
  `:1110-1112` is still the flat unsorted roster.
- **`4d` / `4e`.** `styles.css:853` still `align-items: stretch`; `styles.css:871`
  `.roll-list { display: grid; … }`; `DicePanel.tsx:150` `.roll-list scroll-y`;
  `design-tokens.css:1182` `.scroll-y`. All exact.

**Two path corrections for `4g`:** the scene-prep reference is
`apps/client/src/scenes/ScenePrepPanel.tsx` (**`scenes/`, plural**) — the plan cites the bare
filename, so no path test catches it. Its content checks out: `RECENT_COUNT = 10` at `:28`, the
`lastUsedAt` sort at `:84-88`, the `<details><summary>Recent (n)</summary>` at `:139-143`.

---

## The `4h` test — the one thing that genuinely got harder

The plan says "a fix without that test is not a fix," and specifies a Playwright layout assertion.
**There is no automated home for it.** `apps/client/vitest.config.ts` declares exactly two projects,
`dom` (jsdom) and `node` (mirror tests) — no browser project. Playwright is **deliberately not a repo
dependency** (`scripts/browser-verify.mjs:19-21`, same rule as `tap-audit.mjs`), and
`browser-verify.mjs` is explicitly "a MANUAL audit, not a test… deliberately not wired into `npm
test`." `npm run test` is `npm run test --workspaces`; no script runs a browser.

**The right home already exists and it is not `browser-verify.mjs`.** `scripts/no-scroll-audit.mjs`
drives `/table` for GM **and** player, **in combat**, at eight viewports including landscape phones,
**and it docks left and right** (`:370-386`), measuring both the document and the `.table-layout`
pane on both axes, and exits non-zero. It is `4h`'s harness, `4c`'s harness, and `4e`'s harness
already built — it just does not measure these things yet.

**And that is itself a finding for `4e`:** the no-scroll audit is green today while `4e` reproduces,
because it measures the document and the pane, not every inner scroller. `.roll-list` overflows
inside a passing pane — the same failure class the script's own header says the document probe let
ship. Extending it to the named inner scrollers closes `4e` and pays for `4h` at the same time.

So `4h` is **S for the CSS** (a real two-line edit at a line I read) **plus M for the harness**
(estimated) — and that M is shared with `4c` and `4e`, which is the strongest argument in this
document for the revised order below.

---

## `4i` — re-verified exactly

Every number in the plan is right.

- `MAX_SCENES = 20` (`scenes.ts:15`); `sceneHeadroom = MAX_SCENES - scenes.length` (`:191-193`);
  `sceneSlotsNeededToGoLive` returns `1 + (parksImplicitly ? 1 : 0)` (`:186-189`). So the refusal
  fires at `scenes.length >= 20`, or `>= 19` when the live table must park implicitly —
  **"19–20 of 20", exactly as written.**
- The refusal text is duplicated at `scenes.ts:207` and `replay-launch.ts:111`.
- **The leak is real.** `activateNewScene:219` does `scenes: [...scenes, scene]` and nothing ever
  removes a replay scene; `launchReplay:169` does `state.actors = [...state.actors, ...clones]` and
  nothing ever removes the clones. Each launch permanently consumes one scene slot plus N actors.
- `withReplaySuffix` at `:28`, applied at `:160`. D3's "keep the clone, hide the clone" is unaffected.
- The ride-along is at **`server.ts:433-438`** (plan said `:437-441`): `authorizePlayer` returns true
  only for the live combat map or a codex-revealed atlas asset. Still a viewer-safety change — gate
  on the archive's shared flag, never on "any archived map."

---

## Revised order

The plan's order is **`4h` → `4c`+`4c.1` → `4d`+`4e` → `4g`, with `4a` in parallel and `4b` after.**
I am changing it in two places, both for evidence found above.

**1. `4h` → `4c` + `4c.1` + `4e` (one harness pass) → `4d` → `4g`.**
`4e` moves up and joins the `4c` group. The reason is the harness: `4h`, `4c` and `4e` are three
layout facts that no jsdom test can settle, and extending `no-scroll-audit.mjs` once serves all
three. Doing `4e` later means paying the browser-pass cost twice. `4d` stays adjacent to `4e` (same
`styles.css` dice block, one ratchet run) but no longer needs to precede it. `4g` stays last of the
UI group — it is the largest, and it wants `4c`'s scroll-model fix settled first.

**2. `4b` moves from "after `4a`" to "with `4a` gap 4 (D7)."**
The plan sequences `4b` behind `4a`'s narration refactor to avoid touching `saving-throws.ts` twice.
That reason still holds for the *narration* half (gap 3). But gap 4 and `4b` are now provably the
same change: `ActionRunner.tsx:157-158` already amends damage and already drops `parts` to do it, so
D7's "the damage entry gains an optional type" is the field `4b`'s override needs. Building them
separately means designing the same control twice. **Keep one agent on `saving-throws.ts` +
`hit-points.ts` + `ActionRunner.tsx` and ship gap 3, gap 4 and `4b` as one arc.**

`4a` still starts first and still runs in parallel — it is still the longest pole, and it is longer
than the plan says by gap 5. `4i` and `4f` remain independent; `4f`'s reference implementation
(`codex/MapSurface.tsx:31` pinch member, `:126-134` two-pointer entry) is intact and `EncounterMap`'s
gesture machine is unchanged in shape (7 kinds at `:26-31`, `zoomAt` at `:215`, `beginGesture` `:357`,
`finishGesture` `:466`, `cancelGesture` `:513`, `touch-action: none` at `encounter-map.css:180`), so
D2's estimate stands: **contained, M, ships.**

---

## Defects found in the plan and the ledger

Fix these where they live; they are wrong at HEAD.

1. **`known-bugs.md:456-465`** — the `damage-type-is` / save-only entry was **fixed by `f8ea88e`** and
   must be deleted.
2. **Plan, `4a` §1** — `character-build.ts:206` → **`:304`**.
3. **Plan, `4a` §2** — `character-build.ts:161-163` → **`:244-245`**.
4. **Plan, `4a` §1** — "the maths belongs in `packages/rules-5e/src/combat.ts` … import the same
   specifier" is a **dependency cycle** as stated. The maths may live there; the `DAMAGE_TYPE_IDS`
   import may not.
5. **Plan, `3d`** — "add a shared `normalizeDamageType()` **beside it**" (i.e. in `enums.ts`) is the
   same cycle from the other end. It belongs in `rules-5e`, re-exported.
6. **Plan, `4a` §4** — "four real gaps, and only four" is now **five**.
7. **Plan, `4b`** — `action-resolution.ts:886-905` → **`:908-919`**; `:821` → **`:842-850`**;
   `:1097-1098` → **`:1148-1149`**.
8. **Plan, `4g`** — `ScenePrepPanel.tsx` is under `apps/client/src/**scenes**/`, not `scene/`.
9. **Plan, `4h`** — the `min-height` precedent is `encounter-map.css:396`, not `:389`.
10. **Plan, `4c.1`/`4g`** — the shared pseudo rule is `encounter-panel.css:1500-1528`, not
    `1499-1526`.
11. **Plan, `4i`** — `authorizePlayer` is `server.ts:433-438`, not `:437-441`.
12. **Plan, `4h`** — the required test has **no project to live in**; the plan sizes it as though one
    exists. Use `scripts/no-scroll-audit.mjs`.

---

## Verification performed

Read-only. `git diff --stat c2f3b6b..HEAD` over every Area 3 path (above); direct reads of
`hit-points.ts`, `combat.ts`, `effects.ts`, `character-build.ts`, `saving-throws.ts`, `reactions.ts`,
`player-damage.ts`, `action-resolution.ts`, `choice-overrides.ts`, `scenes.ts`, `replay-launch.ts`,
`server.ts`, `encounter-map.css`, `encounter-panel.css`, `styles.css`, `design-tokens.css`,
`EncounterMap.tsx`, `EncounterPanel.tsx`, `DicePanel.tsx`, `ActionRunner.tsx`, `ScenePrepPanel.tsx`,
`MapSurface.tsx`, `roll-preference.ts`, `enums.ts`, `warlock.ts`, and the three `package.json`
dependency blocks that establish the cycle. Every line number quoted here was read at HEAD, not
carried from the plan. One test run:
`npx vitest run --root apps/server test/warlock-sorcerer-wizard.test.ts` → **46 passed**, confirming
`f8ea88e`'s inverted boundary test is green and the ledger entry standing on it is stale.

**Not verified:** no browser was driven. The four UI regressions are confirmed *present in the
source* — the CSS and markup that cause them are unchanged and I read the causing lines — but no
rendered box was measured in this pass. `4h`, `4c`, `4c.1`, `4d`, `4e` and `4g` each need the browser
pass their plan entries already demand before anyone calls them fixed.

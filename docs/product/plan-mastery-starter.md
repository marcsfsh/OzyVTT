# The flourishes starter — M0, Topple, Push, and the shield-AC bug

**Written 2026-08-14 against HEAD `186e4cf` on `claude/ozyvtt-roadmap-explanation-5rwyro`.** Every
`file:line` below was opened at that HEAD. This is BOTH the unit plan for the next batch **and the
session handoff**: it assumes nothing from any conversation, because the repo is the memory.

Subordinate to [`remaining-program-plan.md`](remaining-program-plan.md) (the governing document) and
to [`plan-mastery-program.md`](plan-mastery-program.md) §3–§4 and §7, which carry these units'
full arguments. Where this document and those disagree, **this one is the measurement** — it was
written three days later, after C9 moved the surrounding code.

---

## 1. Where things stand, in one page

**Branch:** `claude/ozyvtt-roadmap-explanation-5rwyro`, eight commits ahead of `main` (`c2b5206`),
pushed. **Not merged, no PR** — open one only if the client asks.

**What C9 delivered (2026-08-14), because the next unit stands on it.** A magic weapon or armor in
the SRD carries no stats of its own; its printed type line names the BASE it applies to. C9 made
that a mechanism:

- `EquipmentReferenceSchema.appliesTo` (`packages/content-srd-5.2.1/src/schemas.ts`) — the printed
  qualifier plus RESOLVED base ids, joined at build time by
  `packages/content-srd-5.2.1/scripts/build-magic-items.ts` and failing closed by name;
- `InventoryItemSchema.baseId` (`packages/schemas/src/index.ts`) — the player's pick, recorded;
- `bindTemplateItem` (`apps/server/src/inventory.ts`) — the SERVER validates the pick, copies the
  base's stats onto the row, and never trusts a client-supplied block. Five rules live there, four
  of them added by an adversarial review that reproduced each hole: a removal never binds, a
  non-template row strips a forged `baseId`, a `baseId`-less write inherits the stored pick, a
  non-GM write may not swap a pick in place, and a stale pick fails OPEN;
- a flat `damage-bonus` rider (`FeatureModifierSchema`,
  `packages/content-srd-5.2.1/src/character-content.ts`) — the "+1 weapon"'s damage half. Standing
  it folds into the first damage part's printed formula (`apps/server/src/effective-actions.ts`
  `withStandingRiders`); moment-gated it lands as its own labelled `bonusDamage` line
  (`apps/server/src/action-resolution.ts`);
- the pick's two surfaces: the browse-and-add chooser (`apps/client/src/encounter/equipment.tsx`
  `BaseOptionList`) and the homebrew template pair (`apps/client/src/homebrew/schemas.ts`).

**22 of 33 magic weapons now swing with their printed riders.** `sun-blade` and `energy-bow` are
deliberately WITHHELD from binding (`RESERVED_UNBINDABLE` in `build-magic-items.ts`) — their print
is more than their base and the conversion is U20's; a bare-base bind derived a *wrong* swing where
an honest absence stood.

**The verification the client requires** is in §5. It is not optional and it is why C9's review
found fifteen defects that five green suites did not.

---

## 2. The client's standing rulings (four discovery rounds, 2026-08-14)

Recorded in full in `docs/ai-ledger/decision-log.md` (2026-08-14 entry). The ones that bind the
NEXT unit:

1. **This batch is next:** M0 (the dispatch seam) + **Topple** + **Push**, plus **U28** (the
   Barbarian/Monk shield bug). ~3 days.
2. **Deferred by name, do not start them:** U33 (the labelling sweep), B2–B4 (monster display rows),
   F2–F4 (the API defects except F1's badge), and A1's parity guard — which waits until the next
   editor-heavy batch rather than running "before everything". That is a dated reversal of the
   governing plan's ruling 10, taken knowingly.
3. **Parked until the client's campaign has a party:** U20 (the Monk die, and with it Sun Blade and
   Energy Bow), U17 (Bard's Magical Secrets), U35a (two-weapon fighting — whose SCOPE RULING IS
   STILL OWED and must not be assumed).
4. **A wrong number at a table is worse than an absent one.** This is the ruling that killed the
   Sun Blade bind and it governs every judgement call below.
5. **A named absence is the deliverable when a mechanism cannot be honest**: the item or feature,
   the exact printed sentence, the vocabulary it would need, and the unit that unblocks it — in a
   comment beside the entry, never a silent skip.

---

## 3. The units, measured at `186e4cf`

### M0 — the dispatch seam · **S** · serial, blocks the other two masteries

**Why.** Both shipped masteries are inline branches in one file, and every future mastery is another
branch in the same ~20-line region: `graze` at `apps/server/src/action-resolution.ts:987` (fires on
a MISS, which is why it sits outside the damage block) and `sap` at `:1109` (an effect on the target
after a hit). Four units appending there is one hunk touched four times, and the dangerous
resolution drops a branch while leaving the slug in the implemented set.

**What it does, and nothing more.** Move both branches into a new leaf module beside
`action-resolution.ts` — basename `weapon-mastery.ts` — exposing an on-miss hook (returns bonus-damage
entries) and an on-hit hook (returns applied effects), with one registry keyed by slug.
`action-resolution.ts` calls the two hooks where the branches were.

**Three constraints.**

1. **`IMPLEMENTED_MASTERIES` becomes DERIVED** from the registry keys —
   `apps/server/src/equipment-derivation.ts:272` is `new Set(["graze", "sap"])` today and
   `masteryReaches` (`:282`) is the single gate the derivation consults. Deriving it means adding a
   handler IS joining the set, so no unit edits a shared literal.
2. **No import cycle.** `equipment-derivation.ts` imports no other server module on purpose. The
   *registry* (slug keys) must stay a leaf; the *handlers* (which import `effects.ts` /
   `saving-throws.ts`) must not be reachable from it. **If a clean split proves awkward, leave the
   Set hand-written and say so — do not invent a cycle.**
3. **Behaviour must not change.** The proof is `apps/server/test/weapon-mastery.test.ts` passing
   **unchanged, all 12 tests, with no edit to that file in M0's commit.** If one assertion has to
   move, M0 was not a refactor.

### U34 — `topple` (5 weapons: battleaxe, lance, maul, quarterstaff, trident) · **S**

> On a hit, the target makes a Constitution saving throw against DC 8 + your ability modifier +
> proficiency bonus, or has the Prone condition.

- **reader** — an on-hit handler calling `createPendingSaves` (`apps/server/src/saving-throws.ts:164`)
  with `ability: "con"`, `conditionId: "prone"`, `proposedDamage: 0`, `halfOnSuccess: false`.
- **content** — the 5 SRD weapons already author it. Nothing to write.
- **control** — **none, and that is correct.** `weapon.mastery` is a closed 8-slug enum; implementing
  a slug adds no authorable vocabulary. The control is U38's alone.
- **The pattern to copy is ~100 lines away**: the builtin shove at `action-resolution.ts:1214-1234`
  computes this exact DC (`8 + abilityModifier(...) + proficiencyBonus`, `:1217`) and passes
  `conditionId: "prone"` (`:1229`). Topple reuses that shape with `con` and the mastery's own
  `abilityModifier`, which `masteryByActionId` already carries
  (`equipment-derivation.ts`, the `masteryByActionId[weaponAttack.id]` assignment).
- **Far end** — a hit parks a real Constitution save on the foe at the right DC; answering it below
  the DC applies **`prone` in the foe's `actor.conditions`**. Not "the handler was called".
- **375px:** no. Server-only.

### U37 — `push` (4 weapons: greatclub, heavy crossbow, pike, warhammer) · **M** · viewer-safety audit

> On a hit, you can push the target 10 feet straight away from yourself.

- **reader** — an on-hit handler that writes a token position.
- **The seam.** `action-resolution.ts` has no geometry and must not import `token-placement.ts`.
  `geometry` is already fetched inside the operation layer (`apps/server/src/game-operations.ts`,
  the `tokenGeometryFor` calls), so the clean shape is **a new optional callback on
  `ResolveDependencies`** (`action-resolution.ts:55-77`) that the operation constructs and that calls
  `moveEncounterToken` (`apps/server/src/token-placement.ts:155`) internally — reusing the GM drag's
  own snapping, which `docs/ai-context/map-grid.md` requires be the only implementation.
- **Three rulings, so the agent does not invent them.**
  - **Push takes NO client input** — not a destination, not a direction, not a distance. The
    direction is derived server-side from the two token positions; the distance is the SRD's 10 feet.
    That is server authority held correctly: there is nothing for a client to assert.
  - **It moves ONLY `targets[0]`**, which `canPlayerTarget` already cleared at the operation layer —
    and the handler's signature should make that structurally true rather than checked.
  - **Forced movement does NOT route through `applyMovementRules`**, and unmeasurable degrades to a
    WARNING, never a rejection. On a gridless/unscaled map the distance is null and a token with no
    position cannot be pushed; the builtin shove's own sentence shape is the precedent
    (`action-resolution.ts:1234`, *"is pushed 5 feet - move the token."*). **It must not throw** —
    `moveEncounterToken` throws when the token is absent, so guard before calling.
  - **The fog claim in the older plan is STALE — do not implement it.** `apps/server/src/fog.ts`
    reads no token anywhere; no code path recomputes fog from token positions.
- **Far end** — the foe's token position before and after, with the measured distance between them
  equal to 10 feet and the direction away from the attacker, **snapped**.
- **Viewer-safety audit before merge.** Push introduces no new wire field (token positions already
  ship, filtered to public actors in `apps/server/src/projections.ts`). The real questions: can a
  player move a token they do not own (yes — that is the rule, but only `targets[0]` and only after
  the existing target check), and can a player move a HIDDEN actor's token, which would be an
  existence oracle through the revision bump.
- **375px: YES, mandatory.** A forced move can land a token off the visible viewport on a phone.

### U28 — the shield bug, and `unarmored-defense.allowShield` · **L**

**The live bug, reproduced and logged** (`docs/ai-ledger/known-bugs.md`, the `[server/ac]` entry):
`armorClassFromEquipment` (`packages/rules-5e/src/character.ts:99-107`) returns `null` only when
there is neither body armour nor a shield (`:104`); with a **shield alone** it returns
`10 + dex + shield` (`:106-107`). The builder then reads
`(equipmentAc ?? unarmoredAc ?? 10 + dexModifier)` (`apps/server/src/character-build.ts`, the AC
fold near `:1642`), so equipment AC **short-circuits unarmoured defence entirely**. Measured: a
Barbarian CON 16 / DEX 14 reads AC 15 bare-handed and **14 holding one shield — picking up a shield
makes the character strictly worse.**

- **the second half** — `allowShield` is stored (`character-build.ts:592`) and dropped: the AC fold
  reads `interpreted.unarmoredDefense.ability` and nothing else.
- **content** — **2 SRD authors, and the pair IS the test**: Barbarian `{ability: "con",
  allowShield: true}` and Monk `{ability: "wis", allowShield: false}`, both in `classes.v1.json`.
- **control** — ships, **with its own honesty note**: `apps/client/src/homebrew/RiderEditor.tsx`
  carries `note: "Not read yet."` on the `allowShield` row. **U28 deletes that note in the same
  commit** — leaving it is a false honesty note.
- **Far end** — four numbers in one test: Barbarian without shield, Barbarian with shield (+2 **on
  top of** CON), Monk without shield, Monk with shield (unarmoured defence correctly lost).
- **375px:** yes — the note removal, and the AC readout must still fit.

---

## 4. Ordering and file contention

```
M0            serial, first, blocks both masteries
  ├── lane A  U34 (topple) -> U37 (push)      both edit the registry module + weapon-mastery.test.ts
  └── lane B  U28 (shield AC)                 disjoint: rules-5e, character-build, RiderEditor
close         adversarial review of the whole diff, then the battery
```

**The one shared file across lanes is `apps/server/test/weapon-mastery.test.ts`** — its `built` /
`notYet` arrays (near `:279-284`). U34 and U37 each move one slug from `notYet` to `built`, in
alphabetical position; a third assertion compares the UNION against the bundle's own eight, so a
merge that drops a slug fails loudly rather than silently. Lane B never touches it. **Never run two
server suites at once** — the server suite binds a live port.

---

## 5. The verification bar — non-negotiable, and the reason it is stated twice

1. **A far-end proof, driven from a weapon record.** The test ends at a rolled number, an applied
   condition, a moved token position, a refusal, or a rendered string. ***"The value survived
   derivation" is not a test.*** A test whose fixture supplies the very thing the unit builds proves
   nothing — that is how C9's predecessor reported itself finished while being broken.
2. **Two non-vacuity probes per claim, restored by checksum.** Disable the mechanism → name the
   failure that results. Change the value → watch the far end move with it. Quote the exact counts
   and messages, then `md5sum -c` to prove the restore.
3. **A 375px touch pass** for anything with UI: `node scripts/tap-audit.mjs 375`, quote the output,
   the count must not rise.
4. **Never assert a count you did not run.** Quote test-file counts from the run.

**Operational traps, each of which has cost real time:**

- **Never** `npm run build` (it emits compiled output the test runner then collects — ~11 spurious
  failures) and **never** `npm run build-bundle` unless regenerating content on purpose.
- Run a workspace suite **from inside the workspace** (`cd apps/server && npx vitest run ...`);
  `--root` from the repo root reds `design-conventions.test.ts` for a reason that is not the code.
- **Never** `playwright install`. Chromium is at `/opt/pw-browsers`; a driver script needs
  `PLAYWRIGHT_CORE=/opt/node22/lib/node_modules/playwright/node_modules/playwright-core` and
  `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, and must live under the repo
  root to resolve its imports.
- Run `npm run docs` after any state/command/HTTP/OpenAPI change — a freshness test fails otherwise.
  Never hand-edit the generated documents.
- `docs/ai-ledger/current-state.md` is at its enforced **150-line ceiling**. Edit in place by
  replacement; never append.
- **Push after every commit.** A previous session's container rolled local git state back five times
  in one day; nothing was lost only because every commit reached the remote immediately.
- A dev server for a browser pass needs a bootstrapped GM password:
  `POST /api/bootstrap {"password":"testpassword123"}`, then `POST /api/gm/login`. The game snapshot
  is `GET /api/v1/game` (not `/game/snapshot`), and commands go through `POST /api/v1/game/commands`
  with `{type, payload}`. Delete the scratch `data/` directory afterwards.

---

## 6. What this batch does NOT touch

`IMPLEMENTED_MASTERIES` is derived by M0 and then owned by the registry — no other program edits it.
`vex` stays blocked on U22 and `slow` on U18 (both hard blocks, no honest degraded form: a degraded
vex grants advantage against *everyone*, which is a rules bug that looks exactly like the feature
working). `nick` stays blocked on U35a, whose scope ruling is owed. U38 (the homebrew `mastery`
control) is gated on **all eight** slugs reaching, and after this batch four will.

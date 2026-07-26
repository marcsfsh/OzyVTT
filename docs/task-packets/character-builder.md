# Character Builder — implementation plan (guided wizard + level-up + respec + generator)

> **Status:** approved scope, phased delivery. Discovery complete 2026-07-26 (16 decisions, §2).
> Intake evidence: six-specialist intake (UI/UX, encounter, character sheet, SRD content, OpenAPI, synthesis).
> Relates to: ADR-0021 (play sheet, builder-ready), ADR-0018 (PDF import), ADR-0015 (SRD packaging),
> ADR-0007 (additive canonical content), ADR-0016 (public API parity).

## 1. Goal

A comprehensive but **intuitive, refined, polished** guided character builder for **GM and player alike**:
create (levels 1-20, multiclass), **level up**, and **respec**, with a **configurable random generator**.
Built so the later **homebrew update is additive-only**.

## 2. Approved decisions (discovery)

| # | Decision |
|---|---|
| 1 | **Levels 1-20**, full progression |
| 2 | **Multiclass supported** (forces per-class spellcasting + hit-dice pool + prereqs + combined slot table) |
| 3 | **Creation + level-up + respec/rebuild** |
| 4 | **Full page on desktop, full-screen sheet on mobile** |
| 5 | GM creates directly; **player creates → GM approval queue**. While pending, the creator **sees and edits the full sheet** but it is **campaign-inert** (no live actor ⇒ rolls affect nothing) |
| 6 | **Resume on any device** ⇒ server-held drafts |
| 7 | **One claimed character at a time** (creating ≠ claiming) |
| 8 | Generator lives **inside the wizard**, pre-fills every step, stays editable |
| 9 | Generator config: **race, class, level, background, subclass, ability method** — any subset pinned; plus one **"Surprise me"** (standard array, HP = max(roll, average)) |
| 10 | **GM picks the allowed ability methods**; standard array is the default |
| 11 | **Per-species hand-authored name bundles** |
| 12 | **Persistent CC BY attribution footer** in the wizard (ADR-0015) |
| 13 | **Homebrew will cover everything**: classes, subclasses, species, backgrounds, feats, **class features**, spells, **all item types**, monsters |
| 14 | **Phased content**: 2-3 classes end-to-end first (Fighter / Wizard / Cleric), then the rest |
| 15 | **GM grants the level; the player makes the choices** |
| 16 | **44px touch-target floor**, documented app-wide in the design language |

## 3. Architecture principles (non-negotiable)

1. **Features-as-data.** A class/species/feat feature is a declarative record: prose + optional structured
   riders from a bounded vocabulary (reuse `ActionSchema` / `EffectGrantSchema` / `EffectModifierSchema`
   shapes). No feature may be implemented as hardcoded client or server behavior. Homebrew authors the
   *same record type*; the wizard and rules engine cannot tell SRD from homebrew apart.
2. **One merged catalog, one source discriminator.** Every content record carries
   `source: "srd" | "homebrew"`. Merging happens once, at `apps/server/src/content-library.ts`, exactly as
   `loadEquipment()` already merges weapons + armor + gear. Homebrew is the next source, never a fork.
3. **No new closed enums in content.** Identity ids stay open slugs (`/^[a-z0-9-]+$/`). Ordering/labels come
   from data, never from a hardcoded client list (`SKILL_ABILITY`'s hardcoded 18 skills is the anti-pattern).
4. **Choice-provenance ledger is load-bearing.** `character.choices[]` records every decision
   (`{level, classId, kind, id, payload}`): ASI-vs-feat, which list a skill came from, subclass feature picks,
   equipment-pack choice. Level-up and respec are impossible to prefill without it; homebrew needs it too.
5. **`definitionId` MUST be `import-<actorId>`.** Three code paths depend on the prefix
   (`character-edit.ts:15` light-edit, `actor-roster.ts:100` removal, `:119` orphan cleanup). A differently
   keyed PC is permanently un-editable **and** un-removable. One helper owns this construction.
6. **One atomic submit, never per-step commands.** The draft lives server-side for resume, but a *character*
   enters the campaign through a single commit. Ten per-step commands would mean ten revisions, ten
   broadcasts, and a half-built character visible in `actors[]`.
7. **Server authority holds.** The wizard computes previews; the server re-validates every definition through
   `ActorDefinitionSchema` and owns every roll that matters.
8. **API parity from day one.** Every new command and content read ships on **both transports** with an
   OpenAPI operation. No socket-only additions (see §7 debt).

## 4. Data model deltas (additive-optional, ADR-0007; JSON-Schema mirror in lockstep)

**Content bundles (new, hand-authored per the `equipment.v1.json` precedent):**
`classes.v1.json` (12 + level tables + features), `subclasses.v1.json` (12), `species.v1.json` (9),
`backgrounds.v1.json` (4), `feats.v1.json` (~20), `names.v1.json` (per-species pools).
Every record: `{ id, name, source, attribution?, ...typed fields, features: FeatureRecord[] }`.

**`ActorDefinition` (`packages/schemas/src/index.ts`):**
- `character.choices[]` — the provenance ledger (principle 4).
- `character.classes[].hitDie` — per-class hit die (multiclass pools).
- `spellcasting` → **per-class entries** (array or keyed), so Paladin CHA + Wizard INT is expressible.
  Keep the existing single-object shape readable for back-compat.
- `proficiencies` gains armor/weapon/tool/language lists (currently unmodeled).
- `InventoryItem.weapon` gains `properties: string[]` (finesse/versatile/thrown/two-handed).

**`GameState`:** `characterDrafts[]` — server-held drafts (resume-anywhere **and** pending-approval are the
same record). Projected to **the GM and the owning player**, nobody else. Supersedes the GM-only
`pendingImports` queue (migrate it).

**`Actor`:** `hitDice` becomes a **pool** (multiclass: 3d10 + 2d6) rather than one `{die, maximum}`.

## 5. Workstream ranking (from intake)

| # | Workstream | Est. | Note |
|---|---|---|---|
| 1 | SRD content authoring | 15-20d | 12 classes × 20 levels + 12 subclasses + 9 species + 4 backgrounds + ~20 feats + names. **Gates everything.** Phased per decision 14 |
| 2 | Wizard UI | 6-8d | 7 steps × two input modes × full mobile parity + level-up + respec flows |
| 3 | Rules math | 4-5d | All new: ability-gen, class stat priorities, HP/level, slots by class+multiclass, ASI/feat levels, prereqs |
| 4 | New UI primitives | 3-4d | Wizard shell, radio content-card, ability allocator, dice-input row, full-screen mobile sheet, 44px floor |
| 5 | Schema + drafts | 2-3d | §4 deltas + draft store + projection |
| 6 | API plumbing | 2-3d | New commands + content endpoints on both transports + debt repayment |

## 6. Phased delivery

**PHASE 1 — Foundation (the shape).** Freeze contracts so content, rules and UI can proceed in parallel.
- P1.1 Content-record schemas for all six bundle types, with `source` + features-as-data (principle 1).
- P1.2 `ActorDefinition` / `GameState` / `Actor` deltas (§4) + JSON-Schema mirror + back-compat proof.
- P1.3 Rules math in `@vtt/rules-5e`: ability-gen (standard array, `4d6kh3`, point-buy costs, custom
  formula), **class stat-priority tables**, HP-per-level, proficiency-bonus, spell slots (single + multiclass),
  ASI/feat levels, multiclass prerequisites.
- P1.4 Wizard primitives in `@vtt/ui` + `/styleguide` + the documented 44px floor.
- P1.5 API-debt repayment: `character.submit-import` / `resolve-import` into `GAME_COMMAND_SCOPES` + HTTP
  twins; `content:spells` / `content:equipment` HTTP twins.
- **Verify:** `npm run check` + `npm run test` + `npm run build`; old `GameState` still parses; `/styleguide`
  at 375px with touch; route-table equality test green.

**PHASE 2 — Vertical slice (prove it).** Fighter + Wizard + Cleric authored to level 20; species +
backgrounds; wizard creates a level-1..20 single-class character end-to-end; GM path; attribution footer.

**PHASE 3 — Player path + drafts.** `characterDrafts` store, resume-anywhere, pending-approval sheet
(viewable/editable, campaign-inert), GM approval queue UI.

**PHASE 4 — Generator.** Config panel (race/class/level/background/subclass/method) + "Surprise me",
pre-filling the wizard. Zero new API surface.

**PHASE 5 — Remaining content.** The other 9 classes + 12 subclasses + feats, against a proven shape.

**PHASE 6 — Level-up + respec.** GM grants level → player runs the level-up wizard; respec re-runs creation
prefilled from the choice ledger. Requires the write commands that were never built.

## 7. Known debt this update repays

`character.submit-import` / `character.resolve-import` are socket-only — absent from `GAME_COMMAND_SCOPES`,
so invisible to every pinning test (`decision-log.md`: "adding a socket-only or HTTP-only capability is a
regression"). `content:spells` / `content:equipment` have the same gap. Repaid in P1.5, before the wizard's
player path rides on them.

## 8. Top risks

1. Content transcription slips → freeze shapes first; author species/backgrounds to calibrate velocity.
2. Transcription errors ship as rules bugs → snapshot test per class/species + second-pass SRD review.
3. `instantiate()` overrides wizard-computed AC when armor is equipped → wizard must use
   `armorClassFromEquipment`; assert equality.
4. 100-definition cap exhausted by the generator → warn at 80%, GM-gated bulk, prune action.
5. Non-`import-` keying ⇒ unremovable PCs → single helper + test asserting the prefix.
6. `dedupedName` silently renames → show the server's final name in the review step.
7. Per-actor field leaks to players → add to `projections.ts` strip **and** `PlayerActor`'s `Omit`; run the
   viewer-safety auditor.
8. `.nh-steps` blobs at 375px → the shell ships a mobile step indicator, verified at 375px.
9. A `gm-only` PC is invisible to its own claimant → wizard always creates public + `friendly`.
10. Draft projection leak → drafts reach only the GM and the owning player; leak test required.

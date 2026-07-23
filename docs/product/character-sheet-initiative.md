# Character Sheets — Initiative Handoff & Roadmap

> **Purpose:** cold-start handoff for the player character-sheet initiative. If you are a
> new session picking up this PR, read this first (alongside `CLAUDE.md` and
> `docs/ai-ledger/current-state.md`). The **Codebase orientation** section captures what a
> multi-agent exploration already found so you don't have to redo it — but the code moves,
> so re-verify any `file:line` reference before relying on it.

## Status

| | |
| --- | --- |
| **Discovery** | Complete (2026-07-23) |
| **Plan** | Approved |
| **Implemented** | Nothing yet — this is the pre-implementation handoff |
| **Branch** | `claude/character-sheet-discovery-a14i7f` |
| **Next action** | **Slice 0** — foundations + AI-intake tooling (see Phasing) |

Each slice below becomes its own `vtt-task-packet` at implementation time (brief → implement
→ qa-check → ledger). This doc is the roadmap, not a task packet.

---

## What we're building & why

OzyVTT today is **GM-focused**: the GM imports stat blocks, runs combat, and the server
resolves everything. The player surface is thin — claim a character, track HP/conditions,
answer saves, and watch a **read-only** action list that literally says *"the GM rolls
these."* The existing `apps/client/src/encounter/CharacterSheet.tsx` is explicitly
*"track, never build."*

This initiative adds the **player-facing** half of the app: a complete, integrated D&D 5e
character sheet in the spirit of D&D Beyond / Roll20's 2024 module. Players use it at game
night to *see* their character and *act* from it — tap to roll, spend spell slots, manage
inventory, prepare spells — on phone or laptop.

**Intended outcome:** a player opens a rich, mobile-first sheet for their claimed character
and plays the whole combat loop from it, with structured data that the future builder will
simply *populate* rather than replace.

---

## Discovery decisions (what was chosen, and why)

1. **Ambition — "interactive play sheet," architected for a full builder next.** Phase 1 is
   a play sheet (no guided creation), but the data model must let the **full builder** (the
   *next* roadmap update) layer on with **no schema rewrite**. Rationale: the user explicitly
   wants the builder as the immediate follow-up; sheets are used at game night, not between
   sessions, so *playing* the sheet is the near-term value.
2. **All four missing systems are in scope:** class/level/race/background, skill & save
   proficiencies, spell slots & spells, inventory/equipment/currency.
3. **Players initiate their own rolls.** From their sheet a player taps to roll their own
   attacks/checks/saves; the **server still resolves and authorizes** (targeting, cover,
   damage, action economy) — authority doesn't move, only the "tap." Wire the authorization
   so a future *"GM-configurable per table"* toggle drops in with minimal change.
4. **Damage application — GM-confirmed proposal.** A player's hit rolls on the server and
   surfaces a proposal; the **GM confirms** applying it. Players never directly reduce a
   monster's HP (keeps the role/viewer boundary clean).
5. **Authoring — import + light hand-edit.** Definitional data enters via canonical JSON
   import; a player may then **hand-edit their own** character's structured fields (add a
   known spell, tweak a proficiency, edit slot maxima, add an item) without a guided builder.
   Owner-scoped + GM.
6. **On-ramp — JSON now, importers fast-follow.** Canonical JSON import for Phase 1; a **PDF /
   D&D Beyond importer** is a fast-follow (Phase 1.5, cross-refs ADR-0018) before the builder.
7. **AI-intake tooling — both.** An `npm run map` app-map generator + doc (with a freshness
   test) **and** a `.claude` orientation skill.

---

## Codebase orientation (already explored — trust but verify)

**Architecture.** Server-authoritative. The server owns one `GameState`, persisted as a JSON
blob in SQLite (`apps/server/src/game-store.ts`, `DatabaseSync`, WAL, versioned migrations;
whole state re-validated through `GameStateSchema.parse` on load — so additive-optional Zod
fields with `.default()` are the migration mechanism). Clients render + send **commands**.
Every outbound update is **projected per role** (GM / player / public viewer); projection is
the security boundary. Two transports (Socket.IO bare payloads + HTTP `/api/v1` envelopes) are
thin adapters over one shared operations layer.

**Character model — a split.** One unified `Actor` per combatant (thin, live: HP, conditions,
effects, ownership) **+** an immutable `ActorDefinition` (the "stat block / sheet substrate").
Both are Zod schemas in `packages/schemas/src/index.ts`, re-exported via
`packages/domain/src/index.ts`. Definitions live in `GameState.definitions[]` and are
referenced by `Actor.definitionId`.
- Already structured on `ActorDefinition`: `abilityScores`, `proficiencyBonus`, `armorClass`,
  `hitPoints`, `initiativeBonus`, `speedFeet`, rich `actions[]` (attacks/spells-as-actions via
  `ActionSchema`), damage defenses, an open-ended `extensions` bag.
- **Missing (this initiative adds):** class/subclass/level, race, background, feats, skill/save
  **proficiency selections**, spell slots, prepared/known spells, spellcasting ability/DC,
  inventory/equipment/currency. Today these are prose-only or hidden as final totals in
  `extensions["open5e.srd-2024"]`.

**Live-vs-definition precedent to copy.** `actor.hitDice` and `actor.actionUses` seed from the
definition in `instantiate()` (`apps/server/src/actor-roster.ts:27`), are consumed during play,
restored by `applyRest` (`apps/server/src/rests.ts`), and are projected **only to the owning
player**. New live resources (spell slots, inventory, currency) follow this exact mold.

**Per-PC definition keying (makes light-edit safe).** `importActorDefinition`
(`actor-roster.ts:64`) stores each imported PC's definition as `import-<actorId>` — 1:1 with
the actor. Monsters instead *share* bundle definitions keyed by content id
(`addActorFromDefinition`, monster-only). So editing a PC's definition touches only that PC.

**Projection (the security boundary).** `projectPlayerView` (`apps/server/src/projections.ts:117`)
filters actors to `visibility === "public"`, destructures out sensitive fields (`notes`,
`ownerSessionId`, exact `hp`, `effects`, `actionUses`, `conditionImmunities`, `legendary`,
`hitDice`, …), then re-adds owner-only fields with `...(mine ? {…} : {})`. The player's own
`ActorDefinition` is inlined as `ownDefinition` **only when `mine`** (`:136`, `:143`). The
public viewer (`apps/server/src/viewer-encounter.ts`, `viewer-presentation.ts`) reads an
allowlist from `actor` and **never touches `definitions`** — so new *definition* fields are
viewer-safe by construction; only new *live actor* fields need stripping.

**Command pipeline (every new command follows this).** payload in `ClientToServerEvents`
(`packages/domain/src/index.ts`) → Zod schema (`apps/server/src/game-commands.ts`) →
`GAME_COMMAND_SCOPES` + an OpenAPI operation (`packages/api-contract/src/index.ts`, served
byte-identical at `/api/v1/openapi.json`) → handler + `gameCommandRegistry` entry
(`apps/server/src/game-operations.ts`) → socket line (`apps/server/src/server.ts`) → HTTP route
(`apps/server/src/game-http.ts`) → projection. Ownership checks use the `ActorScope` pattern
(`hit-points.ts`). Idempotency via `commandId`; optimistic concurrency via `expectedRevision`;
both handled by `store.execute`. Closest template for a player-allowed resource command:
`actor.spend-hit-dice`.

**Rules engine already present (server, reuse it).** `apps/server/src/action-resolution.ts`
(`abilityModifier`, `resolveDefinitionAction` — attack rolls, 2024 crits, multiattack/Extra
Attack, cover, reactions, action economy), `saving-throws.ts` (`saveModifierFor`, adv/disadv,
auto-fail, legendary resistance), `hit-points.ts` (typed-defense damage pipeline, zero-HP
machine, concentration), `rests.ts` (`spendHitDice`, `applyRest`), `condition-rules.ts`,
`builtin-actions.ts`. **`abilityModifier` / proficiency math is duplicated in ~4 places**
(`action-resolution.ts:95`, `saving-throws.ts`, `rests.ts:30`, `CharacterSheet.tsx:13`) — no
centralized helper in `packages/rules-5e` (which today is only dice + damage adjustment +
adv/disadv aggregation + death saves). Slice 0 centralizes this.

**SRD content (`packages/content-srd-5.2.1`, server-only).** Pre-built JSON bundles: **330
monsters** (full `ActorDefinition`s), **339 spells** (with class tags + upcasting), **18
skills**, **38 weapons**, **13 armor**, **15 conditions**, weapon-properties, damage-types,
rules. Consumed via `apps/server/src/content-library.ts` and served over `content:*` socket
events (`content:spells` already reaches the client). **No class/subclass/race/background/
feat/magic-item/gear content is vendored** — that's builder-phase work.

**Client.** Multi-page Vite (no router; state-driven nav in `apps/client/src/main.tsx` with
`mode: "home"|"player"|"gm"`). Player flow: join (no password) → claim in
`actors/ActorRoster.tsx` → during combat, `encounter/EncounterPanel.tsx` player branch (turn
economy, **read-only** `PlayerActionList` "the GM rolls these", saves/reactions/death saves).
Design system `packages/ui/src/index.ts`: `Modal` (full-screen on mobile), `Tabs`,
`SegmentedControl`, `Stepper`, `Meter`, `Chip`, `Badge`, `Avatar`, `.nh-statlist`. Mobile
parity is a hard rule (`docs/ai-context/mobile-ux.md`). A `/styleguide` route demos every
primitive.

**Wire data a player's own character already carries** (`PlayerActor`,
`packages/domain/src/index.ts:341`): exact `hp`, `effects`, `conditions`, `claimStatus`,
`presence`, and **owner-only** `definition` (full `ActorDefinition`), `actionUses`, `hitDice`.
Skills/spell-slots/inventory are not yet on the wire — new work.

**Scope-boundary tension.** `CLAUDE.md` + ADR-0018/0019 currently state *"not a character
builder."* This initiative reframes that (see Docs/governance → new ADR).

**Existing roadmap alignment.** `BUILD_PLAN.md` §15.3.1 "Combat actor sheet/inspector"
(~lines 1726-1750) already sketches this feature; §14.9 covers resources & spell slots.
Sample characters to render/migrate: `docs/examples/characters/*.json` (three level-7 PCs) and
the three seeded PCs in `apps/server/src/initial-game-state.ts`.

---

## Guiding architectural decisions (load-bearing)

1. **"No-rewrite" contract — store *selections*, not just totals.** The builder's *choice
   inputs* are the durable schema: `proficiencies.saves`/`.skills` as `proficient|expertise`
   selections, `spellcasting.slots` maxima + known `spells[]`, `character.classes[]`/`race`/
   `background`/`feats[]`. Imports that only know final numbers may supply **optional override
   totals** (`saveOverrides`, `skillOverrides`, `spellcasting.saveDc/attackBonus`). A **single
   three-tier resolver** reads `override ?? selection-derived ?? ability-only`. The builder
   later *fills the same selection fields* — resolver and consumers unchanged. (Storing only
   derived totals in `extensions` would force the builder to *replace* them — the trap we
   avoid.)
2. **Immutable definition vs. live actor split** (mirrors `hitDice`/`actionUses`): identity,
   proficiency selections, spell *capability*, and starting loadout on `ActorDefinition`;
   `spellSlots`/`pactSlots` remaining, `preparedSpellIds`, `inventory`, `currency` on `Actor`,
   seeded in `instantiate()`, restored by `applyRest`, projected owner-only.
3. **Per-PC definition keying makes light-edit safe** (see orientation). A `character.set-*`
   edit mutates only that PC's `import-<actorId>` definition (re-validated through
   `ActorDefinitionSchema`), reconciling dependent live state (e.g. clamp `spellSlots.remaining`
   to a new max).
4. **One authorization seam for the future GM toggle.** Replace the 6+ duplicated
   `actor.ownerSessionId !== principal.sessionId` checks with one policy function
   `canInitiateForActor(principal, state, actorId, kind)` in a new
   `apps/server/src/authorization.ts`. Phase 1: GM ⇒ always; player ⇒ owns the actor. The
   future *"players may initiate attacks"* per-table toggle becomes a **one-field add** to
   `CombatState` read in that single function.
5. **Viewer-safe by construction** (see orientation). Every slice still re-reads the two viewer
   files and adds a projection-leak test (a second player + the viewer must never receive
   another PC's sheet/slots/inventory/currency).

---

## Data model (additive; `packages/schemas/src/index.ts` + JSON-Schema mirror)

All fields additive-optional with `.default(...)` per ADR-0007, so old persisted `GameState`
still `.parse()`s. Update `packages/schemas/json/actor-definition.v1.schema.json` in lockstep
(test-enforced).

**On `ActorDefinitionSchema`:**
- `character`: `{ classes: [{id,name,subclass?,level}] (array ⇒ multiclass-ready), race?, background?, feats: [] }`
- `proficiencies`: `{ saves: Ability[], skills: [{id, proficiency: proficient|expertise}], saveOverrides?, skillOverrides? }`
- `spellcasting`: `{ ability, saveDc?, attackBonus?, slots: [{level,max}], pact?, spells: [{id,name,level,prepared,alwaysPrepared,actionId?}] }`
- `startingInventory: Item[]`, `startingCurrency?` (immutable loadout for re-seed).

**On `ActorSchema` (live, seeded in `instantiate()`):**
- `spellSlots: [{level,remaining}] | null`, `pactSlots: {level,remaining} | null`
- `preparedSpellIds: string[]`
- `inventory: [{id,name,quantity,equipped,attuned,weightEach?,description?}]`, `currency: {cp,sp,ep,gp,pp}`

**Derive (helper, never stored):** total level = Σ class levels; save DC = `8+PB+mod`; spell
attack = `PB+mod` (unless override). AC stays the stored total in Phase 1 (auto-deriving AC
from equipped armor is builder work — additive later via an optional `armorClass` on `Item`).

---

## Server work

- **Centralize math** in new `packages/rules-5e/src/character.ts`: `abilityModifier(score)`,
  `proficiencyBonusForLevel`, `saveBonus`, `skillBonus`, `spellSaveDc`, `spellAttackBonus`,
  `characterLevel`. Refactor the 4 duplicated sites to import it.
- **Authorization seam** `apps/server/src/authorization.ts` (`canInitiateForActor`) — swap into
  `actionResolve` (`game-operations.ts`, replacing `requireGmGrade`) with a live re-check inside
  the mutation. Thread initiator role/session through `resolveDefinitionAction` deps so
  `recordRoll` (`action-resolution.ts:73`, currently hardcoded `initiatorRole:"gm"`) attributes
  player rolls correctly; hidden-actor rolls stay gm-only.
- **New commands** (each walks the full pipeline; template `actor.spend-hit-dice`):
  - Play: `character.spend-slot`, `character.restore-slot`, `character.set-prepared`,
    `character.set-inventory`, `character.set-currency`.
  - Light-edit (mutates the `import-<actorId>` definition, re-validated + reconciled):
    `character.set-known-spells`, `character.set-slot-maxima`, `character.set-proficiencies`,
    `character.set-identity`.
  - `action.resolve` (existing): make player-allowed via `canInitiateForActor(...,"attack")`;
    damage stays a **GM-confirmed proposal**.
- **Rest restore:** extend `applyRest` (`rests.ts`) — long rest restores spell slots and
  re-seeds `preparedSpellIds` from defaults.
- **Seeding:** extend `instantiate()` to copy the new live fields from the definition.
- **Projection:** add new live fields to the `PlayerActor` `Omit` (`domain:341`), strip in the
  `projectPlayerView` destructure (`projections.ts:127`), re-add only when `mine` (mirror
  `:144-145`). New definition fields ride `ownDefinition` — no change.

---

## Client work (`apps/client`)

- **Grow, don't replace, `encounter/CharacterSheet.tsx`** into a tabbed interactive sheet using
  `@vtt/ui` primitives: `Tabs` (Combat · Abilities · Spells · Inventory · Features), `Meter`
  (HP + slot pools), `Stepper`, `SegmentedControl`, `Chip`/`Badge`, `Avatar`, `.nh-statlist`.
  `Modal` renders full-screen on mobile; add searchable/collapsible sections (BUILD_PLAN
  §15.3.1).
- **Tap-to-roll:** ability/save/skill rows → `dice.roll` (resolved bonus + `purpose`); attack
  rows → `action.resolve`. **Reuse `RollControls.tsx`** for adv/disadv/manual.
- **Live controls:** slot steppers, prepared toggles, inventory quantity/equip/attune, currency;
  spell rows link the existing `content:spells` reference popover.
- **Light-edit controls:** inline add/remove/edit for known spells, proficiency toggles, slot
  maxima, identity — owner + GM only.
- **`encounter/EncounterPanel.tsx`:** replace the read-only `PlayerActionList` (lines 301-329)
  with an interactive runner — tap attack → pick target → `action.resolve` → result via the
  same preview/confirm flow as the GM's `ActionRunner.tsx`. Add an "Open sheet" affordance on
  the player's own initiative row.
- **`main.tsx` / `actors/ActorRoster.tsx`:** add a sheet entry point from the player lobby.
- **Mobile parity** (hard rule): every tab, tap-to-roll, and control works at **375px** with
  touch.

---

## Intake tooling (Slice 0)

- **`npm run map`:** new `scripts/generate-app-map.ts` → `docs/app-map.md`, reading live sources
  of truth (`ClientToServerEvents` + `GameStateSchema` from `@vtt/domain`; `GAME_COMMAND_SCOPES`
  + `GAME_PATHS` from `@vtt/api-contract`; state-nav in `main.tsx`; a curated key-file index).
  **Freshness test** at `apps/server/test/app-map.test.ts` (that workspace already depends on
  both packages), mirroring `packages/api-contract/scripts/generate-api-reference.ts` +
  `test/reference.test.ts` — re-render and assert byte-equality with the committed doc.
- **`.claude/skills/vtt-orientation/SKILL.md`** (modeled on `vtt-context-router`): points at
  `docs/app-map.md` first, then encodes the 7-step command pipeline, the projection-allowlist
  rule, and the "where does X live" map.

---

## Content

Phase 1 needs **almost no new content** — the 18 SRD skills and 339 spells are already vendored
and `content:spells` is already a wire read. Add only a small exported **skill catalog** (id →
name → governing ability). **Deferred to the builder:** class/subclass/race/background/feat/
magic-item/gear data + the derivation engine.

---

## Phasing (shippable vertical slices — each a future task packet)

- **Slice 0 — Foundations.** Centralize the ability/proficiency/spell math in `rules-5e` +
  intake tooling (app-map + orientation skill). No behavior change.
- **Slice 1 — Data model + richer read-only sheet.** All additive schema fields + JSON-Schema
  mirror; seed live fields in `instantiate()`; extend `ownDefinition`/`PlayerActor` allowlists;
  migrate the 6 example characters. Sheet *displays* everything. No new commands.
- **Slice 2 — Player-initiated rolls (the core).** `canInitiateForActor`; `action.resolve`
  player-allowed with GM-confirmed damage + role-aware attribution; tap-to-roll
  abilities/saves/skills/attacks; interactive `EncounterPanel` runner.
- **Slice 3 — Spell slots & spell management.** Live slots + `spend/restore/set-prepared`;
  long-rest restore; Spells tab; **light-edit** of known spells & slot maxima (+ reconciliation).
- **Slice 4 — Inventory / currency / attunement.** `set-inventory`/`set-currency`; Inventory tab;
  attunement **display-only** soft cap (3).
- **Slice 5 — Identity & proficiency light-edit.** Edit class/level/race/background/feats +
  skill/save proficiency selections on the definition, with sheet edit controls.
- **Phase 1.5 (fast-follow) — External importer.** PDF / D&D Beyond → canonical JSON adapter
  (ADR-0018), targeting the new selection fields.
- **Deferred — the builder.** Guided creation, point-buy, level-up, class/race/background/feat/
  item **content + auto-derivation**, and the GM "players may initiate attacks" toggle (its seam
  ships in Slice 2).

---

## Docs / governance

- **New ADR `docs/adr/0021-player-character-sheet.md`** reframing the CLAUDE.md *"not a character
  builder"* line → *"interactive play sheet now, builder-ready, builder next,"* and locking in
  the selection-vs-override "no-rewrite" contract. Update the CLAUDE.md scope-boundary line to
  cite it.
- **Cross-reference ADR-0018** (PDF ingestion): the new selection fields are its concrete import
  target.
- **BUILD_PLAN.md §15.3.1:** check interaction boxes as slices land; add a "character builder
  (future)" subsection.
- **`docs/ai-ledger/`:** update `decision-log.md` (the reframing + `canInitiateForActor`
  centralization), `current-state.md`, `known-bugs.md`; regenerate `docs/app-map.md`.

---

## Critical files

- `packages/schemas/src/index.ts` (+ `packages/schemas/json/actor-definition.v1.schema.json`).
- `packages/domain/src/index.ts` — `ClientToServerEvents`, `PlayerActor` owner-only fields.
- `packages/rules-5e/src/character.ts` (new) — centralized math.
- `apps/server/src/authorization.ts` (new) — `canInitiateForActor` seam.
- `apps/server/src/{game-operations,game-commands}.ts` + `packages/api-contract/src/index.ts`.
- `apps/server/src/{actor-roster,rests,projections}.ts`.
- `apps/client/src/encounter/{CharacterSheet,EncounterPanel}.tsx` (+ `ActorRoster.tsx`,
  `main.tsx`).
- `scripts/generate-app-map.ts`, `apps/server/test/app-map.test.ts`,
  `.claude/skills/vtt-orientation/SKILL.md`.

---

## Verification (per slice — real evidence, no "should work")

- **Always:** `npm run check` and `npm run test` before calling a slice done.
- **Schema safety (Slice 1+):** old persisted `GameState` still `GameStateSchema.parse()`s; the
  JSON-Schema mirror test stays green.
- **Projection-leak (Slice 1+):** a second player and the viewer never receive another PC's
  `definition`/`spellSlots`/`preparedSpellIds`/`inventory`/`currency`; GM sees all.
- **Auth (Slice 2+):** a player may `action.resolve`/`dice.roll` only for their claimed actor;
  a player's hit yields a **GM-confirmed proposal**, not direct monster-HP mutation.
- **Intake (Slice 0):** `npm run map` regenerates `docs/app-map.md`; the freshness test fails on
  a stale doc, passes once regenerated.
- **Browser + mobile:** `npm run dev`, drive the real flow as a claimed player (open sheet,
  tap-to-roll an attack with GM confirm, spend a slot, prepare a spell, add an item, hand-edit a
  proficiency), and repeat key interactions at **375px** with touch. State what was exercised.

---

## Risks / open items

- **Definition-edit reconciliation:** editing slot maxima / known spells must clamp
  `spellSlots.remaining` and prune/seed `preparedSpellIds`. Handle per `character.set-*` handler;
  cover with tests.
- **Attunement:** display-only soft cap (3) in Phase 1; enforcement deferred.
- **Legacy `extensions.savingThrows`:** kept as a resolver fallback tier while the 6 example
  characters migrate to `proficiencies` (no hard cutover).
- **Slot/cast atomicity:** slot-spend stays a **separate composable command** from
  `action.resolve` (matches existing propose/apply + turn.use/roll separation).

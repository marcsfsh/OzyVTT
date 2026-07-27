# Known bugs & gaps

**Read this when:** starting work in an area, or before claiming something is "done" —
check you're not re-discovering a known issue or tripping a known gap. Add entries as you
find them; remove them when fixed (note the fix in `session-summary.md`).

Format: `[area] — description — suspected cause / status`.

_Last seeded: 2026-07-17. Seeded from code survey + BUILD_PLAN gaps; not yet a live triage._

## Known gaps

- **[character-builder] Phase-2 gating items found by the requirements QA pass (2026-07-26).** The
  Phase-1 foundation is sound, but three things must land before wizard screens are built:
  1. **`fromCatalog` has no resolver.** Ten catalog slugs are authored on feature choices
     (`fighting-style-feats`, `wizard-spells`, `elf-lineages`, …) with no code or documented convention
     mapping any of them to a query — and the spell-list link is severed on the wire in both directions
     (`ContentSpellSummary` drops `SpellReference.classes`; `ContentClassSummary` drops
     `spellcasting.spellListId`). The first Fighter step and the whole Wizard spell step have no data
     path. Must be resolved **server-side** or the implementer will hand-roll a client-side rules
     decision (violates CLAUDE rule 2).
  2. **Decision 10 (GM picks the allowed ability methods + a custom formula) is modelled nowhere.**
     All four methods' math exists in `packages/rules-5e/src/ability-scores.ts`, but no `GameState`
     field, command, or contract carries the setting. `AbilityScoreAllocator`'s `methods` prop cites
     the decision and is unsupplied.
  3. **Class/species/background wire shapes drop wizard-critical fields** — armor/weapon/tool
     proficiencies, `multiclassPrerequisites`, species `abilityBonuses`, background skill/tool/language
     choices. `ProficienciesSchema` just gained armor/weapons/tools/languages with nothing able to fill
     them.
- **[character-builder] No `ClassReference` → `ClassProgressionTable` adapter.** Every rules function
  accepts an overridable table, but nothing constructs one from bundle data, so a homebrew class falls
  through to SRD defaults **silently**: `d8` hit die, sheet-order stat priority, `casterProgression:
  "none"` (⇒ zero spell slots), ASI at 4/8/12/16, and multiclass prerequisites that always pass. Wrong
  answers, not errors. Highest-value missing piece for homebrew.
- **[character-builder] No feature-rider interpreter.** `FeatureRecord.actions/effects/modifiers/
  grants/uses` are read by nothing but the summary projection, which strips them. `content-library.ts`,
  `packages/domain`, and the published OpenAPI `ContentFeature` description all assert "the server
  applies them when it builds the character" — that code does not exist. Largest unscoped Phase-2 item.
- **[character-builder] ~~`resolveSpellcasting` has zero production consumers~~ — FIXED 2026-07-27
  (phase-2 wizard branch).** `CharacterSheet.tsx` now resolves caster numbers through
  `resolveSpellcasting`, one row per casting class (labelled "<Class> caster"), so a multiclass sheet
  can no longer show one DC for two spell lists. Verified in a browser: an Evoker Wizard 3 renders
  "Wizard caster INT / Save DC 13 / Spell atk +5".
- **[character-builder] No server-side builder roll command.** `DiceInputRow` covers manual-entry and
  auto-roll client-side, but nothing server-side accepts a typed builder result the way
  `initiative.roll-self` accepts `natural`. Without it the client owns the roll (violates server
  authority).
- **[character-builder] Homebrew discriminator covers 6 of 9 promised content types.** Spells,
  equipment/weapons/armor, and monsters carry no `source` field, and `EquipmentReferenceSchema.category`
  is a **closed 10-value enum** — a direct conflict with "all item types". (The `SKILL_ABILITY`
  hardcode is **fixed** as of 2026-07-27: `content:skills` carries an `ability` column and
  `CharacterSheet.tsx` drives both the skill list and each governing ability from the catalog, so a
  homebrew skill is now a bundle row and nothing else.)
- **[character-builder] Content/test gaps.** `soldier-a` starting equipment references `dice-set` but the
  catalog id is `gaming-set-dice` — invisible because the cross-reference test checks *class* equipment
  ids and *background skill* ids but not background equipment ids. And
  `character-content.test.ts:65-66` sets only `statPriority[0]` to 13, so Paladin/Monk/Ranger
  (multi-ability prerequisites) will fail the moment they are authored.
- **[ui] A bare `header { max-width: 40rem }` in `apps/client/src/styles.css` clamps every
  `<header>` in the app**, including four `@vtt/ui` primitives (`WizardShell`, `ReviewSummary`,
  `Modal`, `Panel`). It was written for the landing hero. Found 2026-07-27 when it silently clamped
  the character builder's sticky header to 640px, letting the step body scroll visibly through the
  uncovered gutter. `WizardShell` and `ReviewSummary` now defend themselves with `max-width: none`;
  **`Modal` and `Panel` heads are still clamped**. The real fix is to scope the app global (e.g.
  `main > header`), which would also unclamp `.codex-entry-head` / `.acting-console-head` — a visual
  change wide enough to want its own pass.
- **[content] `skills.v1.json` prints "Sleight Of Hand"** (capital "Of"); the SRD prints "Sleight of
  Hand". Harmless but now visible, because the sheet renders the catalog's `name` verbatim instead of
  title-casing the id. One-row data fix.
- **[character-builder] No GM-facing editor for `builder.set-policy`.** The command and the
  `PlayerView.builderPolicy` projection both exist and the wizard honours the policy (it offers only
  the permitted ability methods, and "custom" only when a formula is configured), but nothing in the
  UI lets the GM *set* it — so the table is stuck on the default (all four methods, no custom
  formula). Small VTT-Setup panel; decision 10 is not fully delivered until it lands.

- **[a11y] `--text-muted` fails AA at small sizes** (3.61:1 dark) — affects `.nh-choice-meta`,
  `.nh-statlist dt` and dozens of app labels. Pre-existing, not introduced by the builder work;
  deliberately not retuned mid-flight. Needs its own pass.

### Deferred by the 2026-07-27 readiness pass (found, scoped, not fixed)

The polish pass was bounded to small/medium lift; these were found by it and left, each for a stated
reason. They are **findings, not unknowns** — don't re-discover them.

- **[character-builder] `patch(...)` spreads a stale `draft`** across 5 call sites. Latent, not
  currently reproducible in the wizard's own flows, but the shape is the classic one (a second patch
  in the same tick loses the first). Fixing it properly is a state-model change, not a polish edit.
- **[ui] `h1, h2, h3 { font-weight: 400 }`** in `apps/client/src/styles.css` reaches 32 app-side
  sites, including the Bungee wordmark, which the browser then renders faux-bold. App-wide typography;
  out of scope for a builder pass.
- **[ui] The `→` glyph has no font coverage** — no loaded Manrope subset declares U+2192, so every
  arrow falls back. The fix is an `IconArrow` primitive plus 7 call sites, and it is all-or-none
  (mixing a drawn arrow with a fallback glyph is worse than either).
- **[a11y] `.nh-step--done` marker contrast is 1.97:1 in the light theme** — below WCAG for a
  non-text indicator. The *incomplete* marker was fixed in `584be3a` to carry three signals (dashed
  ring + caution hue + glyph); the **done** marker still leans on hue. Same shape of fix, not applied.
- **[character-builder] Skill/tool/language uniqueness is enforced client-side only.** `479cb80`
  makes held proficiencies arrive greyed with their provenance ("Already granted by Soldier"), which
  stops the silent double-spend in the UI — but the **server's duplicate guard is still per-offer**,
  so a hand-built API payload can still burn two picks on one skill. Server-side global uniqueness is
  the real fix.
- **[rules-5e] Third-caster multiclass rounding** is unverified against the SRD's rounding rule for
  Eldritch Knight / Arcane Trickster style progressions.
- **[character-builder] Step 4's *arrival* state is still heavy at high level** — ~306 cards at
  level 20 before any pick collapses anything. `5c32df9` fixed the *answered* state (24,222px →
  1,933px at L20); the unanswered state is bounded by how many decisions the character genuinely has,
  and cutting it further means progressive disclosure — a design change, not a density fix.

- **[ux] ~~Maps/scenes/encounter IA redesign~~ — RESOLVED 2026-07-22 (scene-centric IA, this PR).**
  The upload → browse → prepare → start experience was rethought scene-first: a new **Scenes** hub tab
  is the prep home (a gallery of scene cards — thumbnail, LIVE/staging badge, go-live, private staging,
  duplicate, drag-reorder, rename, remove); the standalone **Map Setup tab was retired** (its library +
  3×3 calibration fold into the hub via "Manage maps"); **going live also presents the scene's map to
  the shared screen**; and the Encounter tab starts combat on the live scene's map. See
  `docs/product/scene-centric-ia.md` and `session-summary.md` (2026-07-22). Remaining polish (not
  blocking): persisted server thumbnails; the Encounter quick-switch strip could slim further; a
  physical touch-device pass.

- **[mobile] No physical iOS/Android acceptance pass yet** — responsive layout + Pointer
  Events are built and parity is mandated (ADR-0014), but real-device acceptance and a
  degraded-browser fallback UI do not exist. `BUILD_PLAN` GAP-001. Don't claim device
  coverage you haven't actually run.
- **[api] ~~Public API drift~~ — closed 2026-07-18 (PR F on `claude/open-api-core-m75t9d`).**
  EVERY game command is now reachable over `/api/v1` (see `current-state.md`) — combat core plus
  scenes, character claims, token cosmetics, and HTTP player-session issuance. Nothing is
  socket-only anymore; Socket.IO remains the push channel, HTTP the pull/command channel.
- **[api] Credential `gameId` binding is dead plumbing** — `CreateIntegrationCredentialRequest`
  accepts a `gameId`, and `IntegrationCredentialStore.verify` enforces it, but no caller ever
  passes a `gameId` through (`api-v1.ts` / `game-http.ts` wiring), so a credential minted with a
  non-null `gameId` is permanently unusable (generic 403) and `rotate` can't clear it. Predates
  the game API; harmless while everyone leaves it null (this is a single-game product). Either
  thread a real game id through verification or drop the field in a future contract pass.
  Found by architecture review 2026-07-18. **Mitigated 2026-07-18:** the VTT Setup credential
  form no longer offers the field, so the footgun is API-only; the contract keeps accepting it
  for now.

## Gotchas that look like bugs (but aren't)

- **[build] Stale `tsbuildinfo` can mask type errors** — web `check`/`build` are incremental
  (`tsc -b`); a clean `npm run build` resolves confusing results.
- **[auth] Player tokens are not revocable** — only GM sessions have logout/revoke-all; a
  30-day player token stays valid by design. Losing `data/auth.json` or browser storage
  loses GM access/claims with no reset (needs host access).
- **[viewer] Pairing codes are in-memory + single-use** — lost on server restart by design;
  a paired display keeps its persisted token, but new pairings must be re-minted.
- **[maps] Live drag preview can briefly differ from saved geometry** — the client preview
  mirrors server snapping but the server is authoritative; ephemeral annotations
  (measurements ~5s, pings ~4s) rely on a re-broadcast at expiry to resync the viewer.

## How to use this file

Real defects go under **Known gaps** with a suspected cause. If something is working as
designed but surprising, it belongs under **Gotchas** so nobody "fixes" it by accident.

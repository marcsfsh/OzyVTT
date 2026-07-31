# Known bugs & gaps

**Read this when:** starting work in an area, or before claiming something is "done" —
check you're not re-discovering a known issue or tripping a known gap. Add entries as you
find them; remove them when fixed (note the fix in `session-summary.md`).

Format: `[area] — description — suspected cause / status`.

_Last seeded: 2026-07-17. Seeded from code survey + BUILD_PLAN gaps; not yet a live triage._

## Known gaps

- **[codex/ux] Three friction points from the final QA pass still open (2026-07-30).** Seven were raised; the
  owner ruled on four (see `decision-log.md` 2026-07-30) and those are fixed. These three were not ruled on
  and remain design calls rather than defects:
  1. **The four new dashboard cards do not show reveal state** while the two older ones do (Atlas and
     Recently updated show "Shown" / "Hidden"). A hidden deadline and a shared one render identically — on
     the same screen as a feature premised on reveal state mattering.
  2. **Reveal audit: Hide is one-way, and one tap can remove two rows.** Hiding a faction page also removes
     its standing (correctly — the standing is only visible while its page is), with nothing on screen saying
     so, and no way back from where you hid it. The file argues against a bulk un-hide on safety grounds; the
     same argument applies to one mis-tap on a 20-row list.
  3. **The Faction standing card is unbounded and 3 rows tall per faction**, listing every faction page
     whether rated or not, sitting 4th of 9 sections. Deliberately unsliced (it is the only place standing is
     adjusted), but a campaign with 25 factions buries everything below it.
  Also still open: the session console is a full-screen takeover at ≤384px, which undercuts its "consult prep
  while browsing" rationale on a phone.

  _Fixed 2026-07-30 and removed from this list:_ the silent deadline-firing on downtime confirm; the same
  record appearing twice on the dashboard; "Show the pin" not showing the pin; publishing giving no
  confirmation; audit rows not naming their kind; and "GM only" meaning two different things on one row.

- **[codex/export] `GET /codex/export` has no restore path (2026-07-30).** The bundle was completed on the
  owner's decision (calendar, folders, page revisions), so it is a complete *record* of a codex — but
  **nothing reads it back**. The Codex's "Import" button imports markdown files as pages, one per file; there
  is no `importBundle`, no import route, and no consumer of the bundle anywhere in the repo, so restoring
  means hand-editing the sqlite file. `CodexExportData`'s description ("round-trips via the codex import
  surface") is aspirational.

  _The size half of this entry is resolved:_ revision history is no longer unbounded — migration v17 added a
  global switch and a coalescing window (90 minutes by default), and `DELETE /codex/page-revisions` trims
  what already exists. A codex that keeps every save can still reach the measured 20.8 MB, and `express`
  buffers the response, so a large bundle is still one synchronous `JSON.stringify` on the GM's backup path.

- **[codex/history] Nothing coalesces or prunes a page's revisions RETROACTIVELY (2026-07-30).** The window
  applies to new saves only, so a codex that accumulated hundreds of rows per page before v17 keeps them
  until the GM trims from Codex settings. That is deliberate — silently deleting history on upgrade would be
  the destructive act the whole design avoids — but it means the default 90-minute window does not shrink an
  existing codex by itself, and a GM who never opens the settings screen will not discover the trim.

- **[repo/tooling] The committed tap audit cannot see five of the surfaces this programme added.** Its
  `MODES` loop visits the five mode tabs only, and switching mode closes the destinations — so the Sessions
  log, Quests log, Reveal audit, session console drawer and standing dialog have never appeared in a reported
  number. The final QA pass measured all five separately (0 sub-floor, 0 stolen taps at 375 and 320), but the
  script should learn the ops row so the claim stays checkable without hand-written harnesses.

- **[codex/ui] A closed session-console drawer inflates `document.body.scrollWidth`.** `position: fixed;
  translate: 100%` stretches the initial containing block, so `scrollWidth` reads 1648 at a 1280 viewport and
  `innerWidth` reads 734 on a 375px phone. **Inert for users** — `canScrollRightBy: 0`, visual viewport scale
  1, drawer `visibility: hidden`, and the only stretched element is `.app-texture` (`z-index: -1`,
  `pointer-events: none`). But it desynchronises `getBoundingClientRect` from synthesized input coordinates,
  which produced two convincing false findings (a "broken" mobile pin drag, an "unreachable" drawer close)
  before the reviewer caught it. Anyone writing automated mobile tests against this app will hit it.

- **[codex/audit] A revealed unnumbered session with an empty recap renders a blank audit row.** Same defect
  the M12 remediation fixed for journal rows with `AUDIT_JOURNAL_FALLBACK`, left in place one arm over
  (`codex-projections.ts`, the session arm). A row with a Hide button and no label, on the screen whose job is
  saying what the party can see.

- **[codex/search] Four of the five arms of `projectPlayerSearchHit` have no test that fails when broken.**
  Measured: making the page, journal, map or marker arm unconditionally visible leaves all 224 codex tests
  passing; only the quest arm fails. The SQL layer IS covered, which is exactly why the projection's gate is
  never exercised over HTTP — `PLAYER_VISIBLE_SQL` filters the ids first. M10 applied the direct-unit-test
  discipline to the arm it added and never retrofitted the four older ones, while the file claims "Each is
  tested at its own layer for exactly that reason." Not a live leak; a load-bearing gate with no alarm on it,
  and the M6 lesson recurring in the mirror direction. (The journal arm now delegates to
  `projectPlayerJournalEntry`, so it is covered — the other three are not.)

- **[codex/realtime] The `codex:changed` ping tells every player which KIND of record the GM is working on.**
  Measured on a real player socket while the GM created three entirely unrevealed records: `scope: "sessions"`,
  then `"quests"`, then `"journal"`. No content leaks. But the homebrew notifier eight lines below refuses to
  do this on stated principle — "telling players which kind of thing the GM is working on … is a small leak of
  GM intent" — and M9/M10 added `sessions` and `quests` to that union. Two adjacent notifiers, opposite rules.

- **[codex/store] A page that HAD standing and is re-typed away from `faction` keeps its standing row.**
  `setStanding` now requires `entity_type = 'faction'` only to CREATE a row, not to update one, and the
  Campaign card lists any page that already has a row whatever its type is now — otherwise the GM had a
  player-visible number they could neither edit nor reach (verified through the real routes before the fix).
  What remains: a standing row can sit against a character or location page if the GM re-types one. Harmless
  and repairable (zero it, unreveal it, or delete the page), but the data model no longer guarantees what the
  spec asks for. The stricter alternative — refusing to demote a faction that has standing — was rejected as
  the worse trade: it blocks an ordinary edit to protect a rule nothing depends on.

- **[repo/tooling] `apps/server/test/**` is not typechecked by anything.** `apps/server/tsconfig.json` is
  `"include": ["src"]`, so `npm run check` sees no server test file. There are **41 pre-existing type errors**
  across nine non-codex test files (`character-build` 14, `combat-rules-regression` 9,
  `viewer-presentation` 8, …), and M12 briefly added four more to M11's downtime assertions that no command
  in the repo would have reported. Found by an agent typechecking with a temporary config. Fixing the 41 is
  its own job; the gap itself is worth knowing about before trusting "check is clean" for a test-only change.

- **[codex/client] `clampStanding(Infinity)` returns 0, not 100.** `Math.trunc(Infinity)` is not finite, so
  a non-finite value falls through to the `Uninvested` centre rather than the `Exalted` end. Not reachable
  from the bounded number input; documented as intentional in the helper. Recorded because "an overflowing
  control lands on neutral" is a surprising failure direction if it ever becomes reachable.

- **[codex/audit] The published campaign date is not in the reveal audit.** It is a player-visible thing the
  GM publishes (M11's O-1), and the audit lists seven record kinds and not that. Contract-compliant — the
  seven kinds were frozen deliberately — but a GM asking "what can they see?" may reasonably expect the
  party's current date to be on that list. Raised by adversarial review as a scope observation, not a defect.

- **[codex] Renumbering a session orphans its entries and republishes numbers the player gate was
  hiding — OPEN, awaiting an owner decision (2026-07-29, found by M9's correctness review).** The join
  between a session record and its journal entries is the **number**, not the id, and `updateSession`
  does not touch `codex_journal`. So: create session #4, leave it unrevealed, play — entries are stamped
  4 and correctly show players nothing. Then correct the record's number to 5. No record now claims 4,
  the gate's third rule ("no record → unchanged") applies, and **every one of those revealed entries
  starts showing "Session 4" to players again**. The by-session lens simultaneously loses the group, and
  the new #5 has no entries under it.
  The **delete** case behaves the same way but is deliberate and documented in three places ("the number
  on an entry is a label, not a foreign key"); the **renumber** case is documented nowhere and tested
  nowhere. Options for the owner: (1) propagate a renumber to the entries carrying the old number;
  (2) refuse to renumber a session that has entries; (3) accept and warn in the editor, as delete does.

- **[codex] The Graph's sub-floor node count is data-dependent, not 3.** `known-bugs` has recorded "the
  Graph's 3 remain by design" since Stage Six. Measured against a populated database (10 pages) the audit
  reports **30** — the nodes are 36–40px and there is one entry per node element, so the figure scales
  with the campaign. The design decision is unchanged; the number is not a constant and should not be
  quoted as one.

- **[tooling] `scripts/tap-audit.mjs` could not be run as committed — FIXED 2026-07-29.** It hardcoded
  `http://localhost:5173/` and the password `testpassword123`, and navigated by `text=Codex`, which
  matches any ancestor containing the word and timed out with "&lt;main&gt; intercepts pointer events". Every
  run in M9 and M10 needed a hand-patched copy, which defeats the point of committing it. Now takes
  `AUDIT_URL` / `AUDIT_PASSWORD` (defaults unchanged, so the documented `npm run dev` invocation still
  works), selects tabs by role, forces the two navigation clicks the combat roster intercepts, and
  **throws rather than measuring a surface it failed to reach** — a silent zero is worse than a loud
  failure. Verified end to end against `npm run start` on :3001 with env vars only, no edits.

- **[tooling] The audit's "taps stolen" column reported 7 false positives — FIXED 2026-07-29.** The
  outward walk was capped at 30 steps, so reach could never exceed 61px; every control TALLER than 61px
  was therefore flagged unconditionally — 5 Campaign type cards (64px) and 2 Journal composer textareas
  (72px), on every run against a populated database. The walk is now bounded by the control's own size.
  This is the second arithmetic defect found in that predicate; the first was fixed in Stage Six.

- **[tooling] The tap audit over-reported label-wrapped controls — FIXED 2026-07-29 (M10).** A checkbox
  painting 20×20 inside a 44×44 `&lt;label&gt;` was reported sub-floor, though a tap anywhere in the label
  activates it — verified by walking `elementFromPoint` outward, which reached 44px in both axes. Both
  the size calculation and the reach walk now treat a wrapping label as the control. M10's objective
  checklist was the first label-wrapped control in the Codex, so the blind spot had never fired before.
  **A false violation is worse than none: it sends the next session to "fix" working code.**

- **[codex, viewer safety] Auto-linking publishes an UNREVEALED session's number to players — FIXED IN
  CODE; entry kept for the reasoning.** Option (2) below shipped: `playerSessionNumbers` resolves
  `store.unrevealedSessionNumbers()` once per request and `projectPlayerJournalEntry` nulls
  `sessionNumber` when a session record carries that number and is not revealed. Legacy numbers with no
  record behind them are unaffected, exactly as the option promised. **Do not re-solve this.** The
  Codex-overhaul D9 work (journal entries joining sessions by *id*) removes the number-list mechanism
  entirely and gates on session reveal by construction; until then, this is the gate.
  Original report (2026-07-29, M9): a GM creates session 4, leaves it
  unrevealed and activates it; any revealed journal entry written during play carries `sessionNumber: 4`
  to the player, who sees "Session 4", while their session list shows only `[3]` and a direct fetch of
  session 4 is 404. Content never travels — no prep, attendees or recap — only the ordinal and the fact
  that the session exists.
  **Not a new channel:** `sessionNumber` was already in the player journal projection before M9
  (`7e6480d:183`, and in the pre-M9 exact-key-set assertion). What M9 changed is that the number now
  arrives *automatically*, where a GM previously had to type it.
  **Why it is still worth a decision:** the routes go to real trouble to return 404-not-403 on an
  unrevealed session and to null `activeSessionId` for players, both on the stated grounds that a
  session's existence is GM information. Auto-linking routes around that.
  Options put to the owner: (1) accept, and soften the 404-not-403 rationale so it stops over-claiming;
  (2) null `sessionNumber` in the player projection when a real session record exists for it and is
  unrevealed — legacy numbers with no record behind them unaffected, so nothing that works today changes;
  (3) do not auto-link to an unrevealed session — rejected in advance, it breaks the prep workflow the
  feature exists for.

- **[codex] `.codex-back` ("‹ All pages" / "‹ All sessions") is sub-floor** — 13px text with no
  `min-height`. Pre-existing; M9 reuses it for the session log rather than adding a third variant.
  Widening it also unclamps other surfaces, so it wants its own pass.

- **[tooling] `apps/server/test/homebrew-http.test.ts`'s per-path mount probe is vacuous.** It asserts the
  router's own headers prove a path is mounted; because `router.use(...)` is declared with no path and the
  router mounts bare, those headers come back for *any* path — measured, `/completely/unrelated/path`
  returns 404 carrying both. Its path-set assertion is sound; only the probe loop proves nothing. Left
  alone as another milestone's file; the Codex equivalent added in M9 reads Express's route table instead.

- **[codex] `GET /codex/export` documents a round-trip that does not exist.** `CodexExportData` is
  described as "round-trips via the codex import surface", but no route ingests a bundle — the client's
  Import reads `.md`/`.txt` files and creates pages. The export is a one-way backup. Pre-existing.

- **[mobile] The encounter *replay viewer* overflows horizontally at 390px (~99px).** **Pre-existing, not
  introduced by the Codex overhaul** — proven by measuring both paths at 390px: opening a replay via the
  existing "▶ Watch" button on the Replays list (`ReplayPanel.tsx:221`) gives the same 99px as arriving via
  the new Codex "Open replay" link. The Replays *list* itself is clean (0px), as are all Codex surfaces.
  `ReplayPanel`/`ReplayViewer` is a combat-pillar surface and outside the Codex overhaul's approved scope,
  so M2 deliberately did not fix it. Worth noting that M2 makes the screen considerably easier to reach.

- **[ux] The marker inspector is dominated by the icon picker.** Measured live at 1440px: the inspector is
  a 300px rail whose icon grid occupies roughly the first 500px, so every *functional* control — linked
  pages, drill-into map, linked scenes, and (new in M1) linked actor at y≈1082 and the journal readback at
  y≈1188 — sits far below the fold. Pre-existing; M1's two additions lengthen it by ~130px rather than
  causing it. **Deliberately not fixed in M1**, whose scope is giving built capabilities an entry point, not
  redesigning the inspector. Candidate fixes (collapse the picker, or order links above it) are a design
  decision for the Codex overhaul's M5/design pass, not a side-effect of wiring.
  **Status after M5:** still open. M5's scope was the 44px floor and the narrow-viewport gaps, both of
  which the inspector now meets; re-ordering or collapsing the icon picker is a layout redesign that was
  not part of the approved milestone. Carrying forward.

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

### Homebrew system — open items (2026-07-27)

- **[homebrew] Validity is point-in-time.** The publish gate checks a record against the world as it
  stands at that moment. Nothing re-checks **dependents** when the world changes underneath them, so
  deleting or editing a dependency can leave a dependent record published-and-invalid (`restore`
  included). The merge drops an unparseable record with a `console.warn`, so the failure is quiet.
- **[homebrew] `reminted.reason` has no honest value for "not our shape"** — the contract enum is
  frozen, so a pack id that is re-minted for shape reasons reports a collision that did not happen.
  Needs a `packages/api-contract` enum addition.
- ~~**[docs] The reference generator's obligation set seeds from REQUEST bodies only**, so ~84 response
  components document nowhere.~~ **FIXED 2026-07-31** (`c7fc8aa`, Codex overhaul Lane A).
  `renderOperation` now seeds from success responses too — the envelope's `data` component, with the
  existing transitive closure pulling the rows, payloads and branches it reaches — and
  `reference.test.ts`'s *independent* obligation walker widened with it, so a renderer change cannot
  silently reopen the hole. `docs/api-reference.md` went from 91 to **241** rendered shared shapes
  (+1,777 lines), the large mechanical diff this entry predicted.
- **[ui] `--caution-hi` IS `--violet-hi` in all three themes**, and in light `--caution` is literally
  `--violet` (`#7A3FD0`). The "violet is reserved for GM-only" rule is violated by the caution token
  itself. Harmless today only because the team held the every-state-is-a-word rule, so colour
  carries no signal rather than the wrong one. Worth resolving before anything relies on hue.
- **[homebrew] Packs have no UI** — export and import are 2 of the 13 operations, HTTP-only,
  deliberately deferred.
- **[homebrew] Magic-item riders are not authorable yet.** `EquipmentReferenceSchema` is `.strict()`
  and carries no magic vocabulary, so `isMagic`/`riders`/`casts` would be **rejected**, not ignored.
  `RiderEditor` ships built and ready (`ITEM_RIDERS`, `uses` relabelled "Charges"); the section is a
  handful of `FieldDef`s the day the schema grows. **This is the largest remaining piece of the
  approved scope** — the product decision was full item riders in v1.
- **[homebrew] A caster subclass still needs its class published first** (the third-caster check
  reads the class's level table). Not a deadlock — the class side now waits for nothing — but an
  ordering a GM can hit.

### Found by the 2026-07-27 phase-5 content pass

- **[character-builder] ~~Repeated class choices were under-offered, making level-8+ characters
  uncreatable~~ — FIXED 2026-07-27.** The wire carried no repeat count, so the client inferred one
  from `asiLevels` and **only for `asi-or-feat`**; every other repeated choice was offered once while
  the server's capacity is `choose x grants`. The build was then rejected at Create with "needs 4
  pick(s); got 1". `ContentFeatureSummary.grantedAtLevels` now carries the level table's own answer,
  resolved server-side, and the client uses it for every kind. Two defects compounded it, both mine
  from the phase-5 generator: it stamped a concrete `feature.level` on repeated features (which sent
  the client down the single-grant branch), and it omitted `repeatable: true` on the ASI choice that
  the hand-authored Fighter has always carried — taking an ASI at both level 4 and level 8 repeats
  one option id, which `character-build.ts:478` rejects unless the choice allows it. Level 8 went
  from **3/12 to 12/12** classes creatable. Note the pre-existing half: no SRD class had a repeated
  NON-ASI choice until Rogue expertise (1, 6) and Sorcerer metamagic (2, 10, 17) were added, so the
  gap had never been exercised. **This matters for homebrew:** a homebrew class may repeat any
  choice at all, so `grantedAtLevels` is load-bearing for that work, not just this fix.

- **[content] ~~Champion's feature levels disagreed with the source~~ — FIXED 2026-07-27.** The
  hand-authored record carried 2024 feature **text** at 2014 feature **levels**: Remarkable Athlete
  at 7 and Additional Fighting Style at 10 are the old progression, and **Heroic Warrior (level 10)
  was missing entirely**. Resolved against the SRD in favour of the source — corroborated by the
  Fighter class table, which grants subclass features at 3/7/10/15/18. Champion is now Improved
  Critical (3), Remarkable Athlete (3), Additional Fighting Style (7), Heroic Warrior (10), Superior
  Critical (15), Survivor (18). Same family of error as the `tough` feat, in reverse: wrong-edition
  content in an SRD 5.2.1 repo. **The cross-check now covers subclass feature ids and levels** and
  fails the build on drift, and a test pins Champion's six levels for CI (the build script is
  manual). Life Domain's `life-domain-spells-5/-7/-9` are allowlisted in `STAGED_FEATURES`: the
  source prints one entry whose body is a table of Cleric 3/5/7/9 grants, and splitting it into four
  staged features is better modelling than the source, not drift.
- **[testing] The nine generated classes have prose-only features.** Only the choice-bearing ones
  (46 of 185) carry structured riders; the rest are description text, which ADR-0008 permits but
  means a Barbarian's Rage grants nothing mechanically — the resource counts are in `classResources`
  but nothing interprets them. The three hand-authored classes are richer than the nine new ones.
  Expected for a first pass; worth knowing before anyone assumes parity.
- **[content] `weaponProficiencies` gained two qualified slugs** — `martial-light` (Monk) and
  `martial-finesse-or-light` (Rogue), because the SRD grants those classes a *slice* of Martial
  rather than all of it. Flattening them to `martial` would have handed a Rogue a greatsword.
  Nothing consumes the qualifier yet, so equipment filtering by proficiency is not enforced.

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
- **[a11y] `.nh-step--done` check glyph is 1.97:1 against its own fill in the light theme.**
  Recomputed independently from the tokens 2026-07-27 — the figure is exact, but two refinements
  matter. The glyph is an `aria-hidden` SVG with the state also in an `nh-sr-only` label, so the
  applicable rule is **1.4.11 (3:1)**, not 1.4.3; and the marker's **border** (`--cyan` on `--bg`)
  measures a **passing 3.85:1**. So the done state stays distinguishable — what fails is the glyph
  inside it. A real 1.4.11 failure, lower severity than "state invisible". Dark theme is 9.07:1.
  (While measuring: `.nh-step--incomplete` light = 3.91:1, passes. Pre-existing near-miss not from
  this pass — the *upcoming* marker's number is real text at 4.47:1, marginally under 4.5:1.)
- **[character-builder] Skill/tool/language uniqueness is enforced client-side only.** `479cb80`
  makes held proficiencies arrive greyed with their provenance ("Already granted by Soldier"), which
  stops the silent double-spend in the UI — but the **server's duplicate guard is still per-offer**,
  so a hand-built API payload can still burn two picks on one skill. Server-side global uniqueness is
  the real fix.
- **[rules-5e] Third-caster multiclass rounding** is unverified against the SRD's rounding rule for
  Eldritch Knight / Arcane Trickster style progressions.
- **[character-builder] Step 4's *arrival* state is still heavy at high level.** Measured per class
  2026-07-27 (the earlier "~306 cards" figure was wrong — it is class-dependent): **Fighter L20 = 10
  offers / 62 cards**; **Wizard L20 = 12 offers / 467 cards**. The worst case is 467, materially
  worse than filed. The composition is the real story — "Wizard prepared spells" is choose 25 of 203,
  and because collapse is (correctly) derived from `picks.length === capacity`, that one grid stays
  fully expanded until the 25th spell is picked, so a Wizard 20 sits above 200 cards for the whole
  step. `5c32df9` fixed the *answered* state (24,222px → 1,933px at L20) and that fix is real; the
  arrival state is untouched. Cutting it means progressive disclosure — a design change, not a
  density fix.
- **[testing] `apps/client` and `packages/ui` have no test script and zero test files.** The 767
  passing tests cover neither — every readiness commit changed only those two workspaces, so `tsc`
  was the only automated net under the whole pass. This matters most for
  `apps/client/src/builder/build-payload.ts`, which is **pure and dependency-light**: `computeOffers`,
  `prunePicks`, `stepBlockedReason` and `withExpertiseReach` are all functions of `(draft, catalogs)`
  and were exercised headlessly in a few dozen lines with no React and no socket. Highest-value
  testing gap in the repo right now.

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

- **[codex/ux] Switching a page's entity type silently drops the old type's field values.** Since M5 the
  server prunes fields to the effective type (CD-2), and `PageEditor` filters the draft the instant the
  GM picks a new type — with no confirmation. Switching to `note`, which carries no fields at all, wipes
  every value. The data **is** recoverable: every save snapshots into `codex_page_revisions`, which is
  never trimmed, so page History restores the old type together with its values. But a GM who doesn't
  know to look there will read it as data loss. Raised by the M5 review; a confirmation step is a UX
  addition beyond CD-2's approved scope, so it is recorded here rather than built.

- **[ui/touch] `TagInput`'s chip ✕ violates §4's gap budget vertically when the chip row wraps — but no
  tap theft could be demonstrated.** `.nh-taginput-tags` gaps by `--space-2` (8px) and a chip is 24px
  tall, so wrapped rows sit **32px** apart centre-to-centre while each `.nh-chip-remove` carries a 44px
  `::after`. Rows therefore overlap by ~12px, which `design-language.md` §4 forbids: it reasons only
  about *horizontal* neighbours ("consecutive ✕s are a whole chip apart") and never considers the wrap
  case. Reported by an implementation agent as a measured 34px reach on the last chip of a wrapped row.
  **I could not reproduce that number**: my probe measured 45px on all seven ✕s across four wrapped rows,
  and the decisive functional test — a real `touchscreen.tap` 10px *above* a second-row chip's ✕ —
  removed that chip's own tag, not the row above's. The likely reason there is no theft in practice is
  that chips are horizontally offset, so the ✕ boxes seldom align vertically. Pre-existing since M4
  (`PageEditor`); CI-2 widens the exposure to four surfaces. **Deliberately not fixed**: the fix lives in
  `packages/ui/src/primitives/TagInput.css` and would change chip-cloud density for Homebrew as well as
  the Codex — a shared-primitive visual change, outside CI-2's approved scope and not justified by an
  unreproduced measurement. If it is taken up, the fix is `row-gap: var(--space-5)` (20px → exactly 44
  centre-to-centre; go one step further given the M5 sub-pixel lesson) plus a `/styleguide` case that
  actually wraps.

- **[codex/store] Migration v15 is not idempotent, and its failure mode is "the codex will not open".**
  Re-running it (only reachable if its `codex_schema_migrations` row is lost) aborts on
  `ALTER TABLE codex_meta ADD COLUMN published_year` → `duplicate column name`. **Verified**: deleting the
  v15 row from a healthy database and re-initializing throws, and the file is left fully intact — no data
  loss, no stray `codex_journal_new`, all indexes present. Every migration in the file behaves this way
  (none use `IF NOT EXISTS`), so this is consistent rather than new; v15 is simply the first whose failure
  is total rather than partial. The version INSERT is inside the same transaction as the migration, so a
  crash can never record a migration that did not run. Left as-is because making one migration idempotent
  and not the rest would be the worse inconsistency.

- **[codex/chronicle] A calendar reshape can flip a revealed deadline's state from "Passed" back to
  "Approaching".** `fired` derives from `calendar_instant`, which is recomputed from the raw date on every
  calendar write; `normalizeCalendar` clamps a date's month into the new month count. **Verified**: a
  deadline dated month 1, day 25 has instant 89574; shrinking the calendar to a single month clamps it to
  44784, and a deadline the party had seen pass reads as approaching again. The raw date is preserved
  correctly and the reflow is doing exactly what K3 specifies — the flip is inherent to deriving `fired`
  rather than storing it (D11-C), which remains the right trade. Recorded because nothing else says so,
  and because a GM who reshapes their calendar mid-campaign will see it.

- **[codex/client] The client's `dateToInstant` does not clamp the day to its month's length; the
  server's `calendarInstantOf` does.** `normalizeCalendar` stores a `currentDate` day above the month's
  length verbatim (it clamps only at the bottom), so the state is reachable, and the two then disagree by
  a day. **Measured, not theorised**: with the clock on day 31 of a 30-day month, a 5-day downtime has the
  server landing on Alturiak 5 while unclamped client arithmetic reaches Alturiak 6. M11 is not exposed —
  `downtimeProposedDate` hand-clamps before calling it, and the Confirm row now names the server's date
  regardless — but `dateToInstant` still drives the timeline's Today marker and its year grouping, which
  are unclamped. The real fix is to clamp inside `dateToInstant` itself (or to clamp `currentDate`'s day
  in `normalizeCalendar`, which is the lossy write underneath). Both change existing behaviour beyond
  M11's scope, so both were deliberately left.

- **[repo/tooling] `apps/client/test/setup.ts` is outside the client tsconfig and is never typechecked.**
  `tsconfig.app.json` includes `src`, and every client test lives in `src/codex/` — so test files *are*
  checked (confirmed: widening the M11 types produced 14 errors across seven existing test files). But
  the shared setup file is not: appending `const deliberate: number = "not a number";` to it produced no
  error from `tsc`. Anything that moves into that file is invisible to `npm run check`.

- **[RESOLVED 2026-07-29 by M11 / owner decision O-1] The campaign's current in-world date reaches
  players, and always has.** The open product question this entry raised — "if a GM is meant to be able to
  run the campaign clock ahead of the party while prepping, `currentDate` needs a server-side gate, and no
  such gate exists today" — was put to the owner, who chose a private prep clock. `GET /codex/calendar` is
  now role-projected: the GM's `currentDate` is their own clock, players receive the separately stored
  published date, and publishing is an explicit act. Backfilled from `currentDate`, so nothing visibly
  changed for an existing campaign. Original entry kept below for its reasoning.

- **[codex/viewer] The campaign's current in-world date reaches players, and always has.** M7's Campaign
  dashboard shows a "Now: …" chip to players as well as the GM. That is **not** a new exposure:
  `GET /api/v1/codex/calendar` (`codex-http.ts:522`) returns `store.getCalendar()` **unprojected to any
  authenticated role**, and it predates M7 — the dashboard only surfaces what the server already sent.
  It is also consistent with the `inWorldLabel` every revealed journal entry already carries. Recorded
  because there is a real product question underneath: **if a GM is meant to be able to run the campaign
  clock ahead of the party while prepping, `currentDate` needs a server-side gate**, and no such gate
  exists today. Raised by the M7 implementer rather than decided unilaterally. Not a leak of GM-only
  content as the system is currently specified; revisit if prep-ahead becomes a supported workflow.

- **[codex/graph] Framing orphans can, in principle, compress a dense graph enough for M5's tap cap to
  bind — not reproduced.** CI-8 changed the auto-fit to frame every node, including unconnected ones
  (before, an orphan sat outside the viewBox with an effective hit area of **zero**). The implementer
  disclosed a trade-off: on a 4-node layout at 375px the tighter fit put two nodes 28.7px apart on
  screen, so M5's nearest-neighbour cap correctly refused to give both a 44px area, and they measured
  28.7px. **CORRECTION (Stage Six): it reproduces, and my non-reproduction was a coverage failure.**
  I first recorded this as *not reproduced* — I had seeded only 5 nodes (3 orphans) and measured all 5 at
  **44.7px**, inside the frame. The final QA pass, against a populated database, measured **3 of 8 nodes at
  17.1–17.6px** at 375px, and I confirmed it independently after remediation: Pages and Atlas went to zero
  sub-floor controls while the Graph's 3 remained. Five nodes simply do not cluster tightly enough to bind
  the cap. This is the same lesson as the tap audit itself — the measurement was right, its coverage was not.
  **Still deliberately not fixed**, and the reason is stronger than convenience: the cap is precisely what
  stops two nodes ~17px apart from being handed overlapping 44px areas, which would trade a small *visible*
  target for an invisible **wrong-node** tap. Removing it makes the graph worse, not better. The real fixes
  — more spacing in `computeLayout`'s force simulation, or a zoom-to-fit floor — change every existing
  layout and belong to their own change. Zoom already recovers it: 1× → 28.7px, 1.56× → 44.7px for every
  node.

- **[codex/graph] The node hover/focus ring paints on the invisible 44px hit circle.** `.codex-graph-node.is-hover circle`
  and `:focus-visible circle` are unscoped, so they stroke *every* circle in the node group — including
  M5's transparent hit circle, which is far larger than the painted node. Pre-existing (M5 added the hit
  circle; these rules predate it), spotted during M7. CI-8's new `.is-focus` rule scopes itself off the
  hit circle correctly, so the pattern to copy is already in the file.

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

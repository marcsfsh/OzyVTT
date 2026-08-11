# Known bugs & gaps

**Read this when:** starting work in an area, or before claiming something is "done" —
check you're not re-discovering a known issue or tripping a known gap.

**Every entry under *Known gaps* is reproducible at HEAD.** Add one when you find a real
defect, with the evidence that it is real. **When you fix one, delete the entry** — the
regression test is the memory, not a line here (D9). Resolved entries are in
`docs/archive/ai-ledger/known-bugs-resolved-2026-08-01.md` and
`docs/archive/ai-ledger/known-bugs-resolved-2026-08-05.md`. If a claim here and the code
disagree, the code wins and the entry is a defect: fix it or delete it in the same change.

Format: `[area] — description — suspected cause / status`.

## Known gaps

- **[codex/rail] Three of the folder menu's five items cannot be tapped at 375px.** Measured
  2026-08-11 on `/codex/pages`, GM, 375×667 with touch: the rail's `Menu` popover renders 5 items at
  **44×184** — every one clears the tap floor — and `elementFromPoint` at the centre of three of them
  answers with something else: *New subfolder* ← `div.codex-rail-tools`, *New page here* ←
  `aside.codex-rail` itself, *Rename folder* ← `input.nh-input`. *Move to top level* and *Delete
  folder* own their centres (an earlier version of this entry said only *Delete folder* did;
  re-measured 2026-08-11 by the independent review pass, same three thieves, same three items).
  The theft is position-bound: scrolling the popover (which moves it relative to the fixed tools
  row and search input) frees the stolen items — a driven `.tap()` that auto-scrolls first lands —
  which points the diagnosis at the overlap geometry, not the items themselves.
  **It is NOT the `isolation: isolate` trap** that this same rail's tag combobox had (fixed in
  `codex.css`, `.codex-rail:has(.nh-combobox-list)`): every thief here is INSIDE the rail, so lifting
  the rail changes nothing — extending that selector to `details.nh-menu[open]` was tried and
  re-measured at still 3 stolen. Suspected cause: the primitives in `.codex-rail-tools` and the
  `.nh-input` beside them carry `isolation: isolate` of their own, so each is a stacking context that
  the popover's `z-index: 40` is competing with rather than clearing. Wants its own diagnosis; the
  popover may need to leave the rail's subtree entirely (the `Modal`/`Drawer` route) rather than win
  a z-index argument inside it. **The 44px audit cannot see this** — `scripts/tap-audit.mjs` measures
  size, not reach, and never opens this popover.

- **[encounter/saves] A save preview projects the PRE-defence number, so the prompt prints more than
  the commit lands against any resistant target.** `answerSave`'s preview arm returns `outcomeDamage`
  — the halved, re-typed total — and it `return`s from ABOVE the call to `applyDamageDetailed`
  (`apps/server/src/saving-throws.ts`, the `if (!commit) return` immediately preceding it). Only the
  commit arm reports `application.totalApplied`. Every defence is therefore invisible to the preview:
  resistance, vulnerability, immunity, Petrified/Underwater and flat `damage-reduction` riders.
  Measured 2026-08-10 through the client's own payload builder, the server's `.strict()` schema and
  `answerSave`, on a fire-resistant target with `halfOnSuccess` and a save that succeeded 18 vs DC 15:
  an amend of **12** projects **6** and the commit applies **3**. Pinned as it behaves — not as the
  prompt claims — by *"projects the PRE-defence number on a recheck"* in
  `apps/client/src/encounter/save-damage.mirror.test.ts`; when this is fixed those numbers converge
  and that test changes on purpose. **Not specific to the amend:** the un-amended Roll preview has the
  identical shape (17 projected, 8 applied), so the fix belongs to the preview path, not to `4b`. The
  honest fix is a dry-run projection through the same pipeline that applies nothing — no hit points
  moved and no receipt a commit would double-count — which is a change to the authoritative damage
  path and wants its own review pass. `SavePrompt`'s docblock and `current-state.md:31` both used to
  assert the opposite; corrected 2026-08-11.

- **[encounter/damage] Editing the pre-filled number on a parked player hit drops its damage types, so
  Apply bypasses every defence.** `resolvePendingDamage`'s `amount !== undefined` arm
  (`apps/server/src/player-damage.ts:83-85`) builds `{ amount, critical, sourceName }` and never
  forwards `proposal.proposedDamageParts`, so `damagePartsOf` returns null in `applyDamageDetailed`
  (`apps/server/src/hit-points.ts:170`) and the whole typed pipeline — resistance, immunity,
  vulnerability, Petrified/Underwater, flat `damage-reduction` — is skipped. Measured 2026-08-10
  against a fire-resistant target holding a 10-fire proposal: an untouched Apply lands **5** with
  `parts` naming the halving; typing **12** lands **12**, not 6, with `parts` empty. The GM's route
  to it is the editable field in `PendingDamagePrompt`
  (`apps/client/src/encounter/EncounterPanel.tsx:694`), whose own docblock at `:673-678` says Apply
  goes "through the typed-defense pipeline" — the server's docblock is honest about the override
  ("no defense math"), the client's is not. **`ActionRunner`'s Apply already carries the fix for this
  exact shape** and its comment says so (`apps/client/src/encounter/ActionRunner.tsx:150-154` — "a GM
  correcting 17 to 12 handed a fire-resistant target all 12"): send the parts and let the server
  re-weight them. The same shape is owed here, and `DamageResolveSchema`
  (`apps/server/src/game-commands.ts:239`) carries no `damageOverride` for the amend to ride on.

- **[encounter/damage] The save and reaction acks carry a typed breakdown nothing reads.**
  `SaveAnswerResult.outcome.parts` / `.flatReduction` (`packages/domain/src/index.ts:1028`) and
  `ReactionAnswerResult`'s pair (`:1030`) are computed and put on the ack by `game-operations.ts`;
  `SavePrompt` and `ReactionPrompt` (`apps/client/src/encounter/EncounterPanel.tsx`) take
  `success`/`total`/`dc`/`appliedDamage`/`conditionApplied`/`rollMode` and stop. Measured 2026-08-10:
  `outcome.parts` has two client readers and both are mirror tests
  (`apps/client/src/encounter/save-damage.mirror.test.ts`); **`flatReduction` has no reader anywhere
  outside the server that writes it** — it appears only in `hit-points.ts`, `saving-throws.ts`,
  `reactions.ts`, `game-operations.ts` and one server test. So a hit halved by resistance and then cut
  by a `damage-reduction` rider explains itself on `actor.apply-damage`'s path
  (`apps/client/src/encounter/ActionRunner.tsx:166`) and stays a bare number on the save's and the
  reaction's.

- **[repo/verify] The sheet and its browse-and-add picker are measured BY HAND, because the tap audit
  cannot reach either.** Both `play-sheet` and `play-sheet-picker` resolve their address from
  `[data-token-id]` on `/table`, which exists only for a combatant in a running fight — on a dev
  database with a PC merely on the roster both report NOT MEASURED, and every control on the two
  surfaces contributes nothing to the number the audit prints. That is not a small blind spot: it is
  the 451-row catalog and the inventory row, on the surface a phone is mostly holding.
  Their previous entry here — the picker's *ten* sub-floor controls, `input.sheet-picker-search` at
  34.3px and nine 19px `button.sheet-picker-chip` — was **fixed 2026-08-11** in the magic-item ETL
  commit (`min-height: var(--tap-min)` on both, route 1 rather than `.tap-target`, because the chips
  wrap and an `::after` overhang would steal from the chip above). Re-measured there directly in
  Chromium 1194 at 375×667 with touch: all **12** chips 44px tall, search 303×44.
  An earlier version of this entry then named `.sheet-remove` at **29.6×29.6** as a remaining
  sub-floor control; **that was a false violation and is retracted** (2026-08-11, the C6 review pass).
  `.sheet-remove` is an `IconButton`, `IconButton` adds `tap-target` unconditionally
  (`packages/ui/src/primitives/Button.tsx:83`), `.tap-target::after` is a centred
  `max(100%, var(--tap-min))` = 44px (`design-tokens.css`), and the audit's own size is
  `max(rect, ::after)` (`scripts/tap-audit.mjs`). 29.6 is its **paint**, and
  `packages/ui/src/primitives/Button.css` names `.nh-iconbtn` exempt from the paint floor for exactly
  this reason — "they reach the floor by route 2". The control measures 44×44 and always did. Logged
  here because the audit's own docblock calls this failure out by name: *"a false violation is worse
  than none: it sends the next session to 'fix' working code."*
  **Still true and still owed:** the audit reaches neither surface, so nothing on them is in the
  printed number. That is a fixture gap rather than a structural one — with a fight seeded, the
  2026-08-10 run *did* measure `play-sheet-picker` at 328 controls.

- **[ui/touch] The row-tools popover and the token context menu ship sub-floor controls, and the tap
  audit opens neither surface.** Measured 2026-08-10 in Chromium 1194 at 375×667 (dsf 2, isMobile,
  hasTouch) by design-language §4's own rule. The initiative row's popover (`.hp-editor`,
  `apps/client/src/encounter/EncounterPanel.tsx:1342`) is **six** controls all **38.9px tall** —
  Amount 67.2 wide, Dmg 40.4, KO 35.4, Heal 39.8, Temp 45.8, Set 35.4. The token menu
  (`apps/client/src/scene/TokenContextMenu.tsx`) is **eleven**: Amount 54.4×41.6, Dmg and Heal
  63×41.6, two `select` at 190×38, `summary.token-context-conditions-summary` 190×35.3, and five
  `button.token-context-item` 190×41.6 — the 41.6 is `.token-context-hp > button`'s
  `min-height: 2.6rem` (`apps/client/src/scene/encounter-map.css:759`) exactly. **None of the
  seventeen is in the audit's 30**: neither surface is in `scripts/tap-audit.mjs`'s route list, which
  touches `[data-token-id]` only to read an actor id for the sheet address. Same blind spot the
  `[codex/verify]` entry below records for `.dice-custom > summary`, on the surface a GM adjusts hit
  points from.

- **[repo/verify] `scripts/tap-audit.mjs`'s `play-homebrew-picker` surface cannot open, so the audit's
  non-zero exit is not always a floor failure.** Its opener takes the `.first()` combobox inside
  `.hb-detail` and clicks it. Measured 2026-08-10 with one real record in the rail: that first match
  is the `Answers to` box, **0×0 inside a `div.nh-roweditor-body` carrying `hidden`** — the collapsed
  `RowEditor` row the script's own docblock already knows about — so the click waits out its 8s and
  the surface reports NOT MEASURED, while `play-homebrew-record` measures 203 controls (78 inside a
  closed disclosure) and `play-homebrew-feature` 288, both clean, for a run of 2622 controls and
  **one** unmeasured surface. On an **empty** library — which is what the dev database holds, the two
  earlier fixtures having been soft-deleted — all three homebrew surfaces go unmeasured instead ("no
  homebrew row in the rail"): 2131 measured, 30 below the floor, 1 unreachable, **3** surfaces NOT
  MEASURED. (That 30 is the 2026-08-10 total and **ten of it is now fixed** — the picker's search and
  nine chips, in the C6 commit — so a re-run on the same database would print 20. The figure is left
  as measured rather than adjusted on paper; what it dates is the run, not today.)
  Either way the exit code is 1 for the unmeasured surfaces, not for the 30. Its sibling
  `play-homebrew-feature` finds its target by walking the rail; this one does not.

- **[codex/touch] The pin inspector's "Show the pin" is the audit's one unreachable control.**
  `node scripts/tap-audit.mjs 375` at HEAD (2026-08-10): on `pin-inspector` (`/codex/atlas`),
  `button.nh-btn nh-btn--ghost interactive "Show the pin"` measures **44 tall × 158.1 wide with
  reach 0** — the size is fine and `elementFromPoint` at its own centre answers with something else.
  It is the only `UNREACH` row in a 2131-control run and it is in the **active** layer, so it is not
  the overlay/disclosure exemption the `[codex/verify]` entry below describes. Unowned; what is
  painted over it has not been identified.

- **[repo/tooling] `npx vitest run --root apps/client` from the repo root reds
  `design-conventions.test.ts` for a reason that is not the code.** `CLIENT_SRC` and `UI_SRC` are
  built from `process.cwd()` (`apps/client/src/design-conventions-shape.ts:38-39`), and `--root`
  moves vitest's root without moving the process's cwd — so `assertRoots` looks for `main.tsx` under
  the repo root, and the suite fails to COLLECT with `ENOENT`, printing "1 failed / no tests".
  Measured both ways 2026-08-10: from the repo root the file does not collect; `cd apps/client` then
  `npx vitest run src/design-conventions.test.ts` is **34 passed**. Three separate lanes reported it
  on 2026-08-10, so it is not a one-off. Run a workspace suite from inside the workspace.

- **[homebrew/editor] A homebrew weapon cannot be given a mastery.** The API accepts `mastery` on
  `equipment.weapon` and the engine reads it, but the editor's weapon block has no row for it, so a
  GM's greatsword can never Graze. Owner: mastery program **U38**, gated on all eight slugs reaching;
  it is the CONTROL half only — the data shapes and the readers landed 2026-08-10 in batch 0.
  **`properties` was the other half of this bug and is FIXED** (2026-08-11, content program **C3**):
  the weapon block's sixth row is a `tags` chooser over `WEAPON_PROPERTY_IDS`, open like every other
  SRD vocabulary control, and `weapon-properties.mirror.test.ts` swings a GM-authored Finesse weapon
  off Dexterity through the real controls, the real wire and the real catalog.

- **[server/ac] A Barbarian or Monk holding a shield loses their Unarmored Defense.**
  `armorClassFromEquipment` returns non-null for a shield alone, so equipping only a shield replaces
  the Constitution/Wisdom AC path instead of adding +2 to it. Found 2026-08-10 by PLANNER-ENGINE.
  Owner: engine program **U28** (`docs/product/plan-engine-program.md`), together with
  `unarmored-defense.allowShield` (2 SRD authors: Barbarian `true`, Monk `false`).

- **[homebrew/editor] The "inherit the damage type" empty box mints unpublishable records.**
  `RiderEditor`'s extra-damage row documents an empty `damageType` as "same as the weapon's", and
  `blankModifier` seeds exactly that — but the schema refuses both `""` ("String must contain at
  least 1 character") and absence ("Required"), and the reader fallback that would honour the inherit
  is unreachable. Every extra-damage row the editor mints fails publish with no client message.
  Owner: engine program **U23+U30** (merged).

- **[homebrew/editor] Tapping "Add a spread" makes a background unpublishable.** The
  `abilityOptions.spreads` control mints `{amounts:[2,1]}` plus a `label` key against a schema of
  bare number arrays — the shape is refused at publish and the editor offers no way to author the
  legal one. Found 2026-08-10 by PLANNER-API. Owner: API program **D3**
  (`docs/product/plan-api-program.md`).

- **[homebrew/sheet] A homebrew monster's typed resistances bite mechanically and render blank.**
  The engine applies `damageResistances`/`damageImmunities` from the typed columns, but the sheet
  renders the `open5e.srd-2024` extension prose — which a homebrew record does not carry — so the
  defenses work in the fight and are invisible on the card. Found 2026-08-10 by PLANNER-API; logged
  here rather than folded into a unit. Unowned.

- **[api/homebrew] Three API contract defects, planned as API program F1–F4.** (1) The server never
  stamps `source: "homebrew"`, so an API-authored record publishes badged as bundled SRD content —
  and eight false doc descriptions say the opposite while the summary shape says something different
  again inside the same response. (2) Publishing a monster hard-requires two
  `extensions["open5e.srd-2024"]` keys that appear zero times in the published contract. (3) The
  closed SRD slug vocabularies are neither published to callers nor validated at publish, so a wrong
  slug ships silently inert. Evidence and units: `docs/product/plan-api-program.md`.

- **[api/content] A feature with two pick blocks is served under BOTH spellings, and the older one
  carries only the first block.** Measured 2026-08-11 while landing C4: the Wizard's `spell-mastery`
  now authors `choices` (a level-1 block and a level-2 block), and the wire populates `choice` as
  well — set to the FIRST block, not to null. A consumer reading only `choice` therefore sees "pick
  one level-1 spell" and silently drops the level-2 pick entirely. The client is not affected:
  `featurePicksOf` (`apps/client/src/builder/build-payload.ts:130`) prefers `choices` whenever it is
  non-empty, which is why the builder renders two rows. It is the PUBLIC API surface that misleads,
  and the trap grows with every feature converted to the two-block shape (Magic Initiate and the
  four Mystic Arcana are already there). Not a projection leak — both spellings are player-facing
  content. Suspected fix: serve `choice` as null when `choices` holds more than one block, or drop
  the compatibility spelling from the published contract and say so in the API reference.

- **[codex/export] A large backup bundle is one synchronous serialization on the GM's request
  thread.** The restore path itself shipped (`POST /codex/import` → `store.importBundle`), and
  migration v17 bounded revision growth with a global switch plus a coalescing window, with
  `DELETE /codex/page-revisions` to trim what already exists. What remains is throughput: a codex
  that kept every save was measured at 20.8 MB, `express` buffers the response, so the export is a
  single blocking `JSON.stringify` while it runs. Not a correctness problem; worth knowing before
  anyone puts a backup on a timer.

- **[codex/backup] `export -> import -> export` is not byte-stable for a codex whose calendar was never
  set.** The first export omits `calendar.currentDate` entirely (`DEFAULT_CALENDAR` has no such key); after
  a restore, `normalizeCalendar` writes it as an explicit `null` and the second export carries it. Content
  is identical either way and nothing reads the difference, so this is a stability wrinkle rather than data
  loss — found while writing the R2 round-trip test (2026-07-31 server QA pass), which scopes its
  byte-comparison to the journal and sessions sections because of it. The one-line fix is
  `currentDate: null` on `DEFAULT_CALENDAR`, deliberately NOT taken in a server-only pass: it would flip the
  key from absent to null in every `GET /codex/calendar` response for a codex that never set one, which is
  a client-visible change.

- **[codex/store] `normalizeBundle`'s `inWorldDate` accepts an unbounded year where the write path caps it
  at ±100,000.** `date()` only truncates, so a hand-edited bundle can carry `year: 9e15` and reach
  `resolveDate` INSIDE the import transaction, where a `calendar_instant` beyond `Number.MAX_SAFE_INTEGER`
  is a STRICT-column write failure. The transaction rolls back and the caller now gets a sanitized 500
  rather than driver text, so the codex is safe and nothing leaks — but the file's own rule is that "an
  import cannot write a row a POST could not", and this is the one validator that is laxer than its POST
  twin. Found during the 2026-07-31 server QA pass while looking for a post-BEGIN failure; not fixed there
  because bounding it would have removed the only failure mode the new rollback test could use, and the
  test was the higher-value change. Bound `date()` and keep the rollback test's probe index.

- **[codex/graph] Graph nodes are below the 44px touch floor and will stay there.** Re-measured
  2026-08-01 in both shells against a populated campaign: at 375px **16 nodes** are sub-floor (GM 10,
  player 6) at 14.2–18.4px wide × 11.2–49.5px tall; at 320px **24** (GM 18, player 6) at 12.1–43.4 ×
  9.4–43.4. **The two widths do not agree and the count is not a constant** — node size is data-driven
  and the layout is force-fitted to the canvas, so a narrower canvas and a bigger campaign both push
  more nodes under the floor. (Earlier entries here quoted "3", then "16 of 16 at both widths"; the
  first was a constant that never was, the second was true only of the data it was measured on.) A 44px
  area per node overlaps its neighbours at any realistic density, so the floor and the layout are in
  direct conflict and enforcing the floor destroys the thing being tapped. Recorded as an accepted
  exception in `design-language.md` §4 with its three mitigations (pan/zoom, every node also reachable
  from Pages and the palette, the graph is a view onto connections rather than the only way to open
  one). Reproduce with `node scripts/tap-audit.mjs 375`.

- **[ui] `MarkdownEditor`'s suggestion list puts `role="option"` on the `<li>` and the click handler on
  a `<button>` inside it; `Combobox` puts the role on the button itself.** Two shared primitives, two
  shapes for one ARIA pattern — and an interactive element inside an `option` is not what the pattern
  intends. Nothing is broken for a user: the keyboard path is driven by the textarea and the mouse path
  by the button. Found 2026-08-01 while writing the first behavioural tests for either primitive (the
  tests click the inner button and say why). Worth one pass over both, together, rather than a change
  to whichever is edited next.

- **[codex/css] `.codex-modetabs` and its scroll-cue rules survive in `codex.css` with no markup left
  to match them.** The five-mode tab bar they styled was retired by D1; grep finds the class only in
  the stylesheet. Dead rather than wrong, so nothing renders differently — but a stylesheet that still
  describes a retired component is the kind of evidence a later reader trusts. Not deleted here: it
  wants one sweep over every selector the recut orphaned, with a visual check, not a single-class
  deletion at the end of a polish pass.

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

- **[codex/history] Nothing coalesces or prunes a page's revisions RETROACTIVELY (2026-07-30).** The window
  applies to new saves only, so a codex that accumulated hundreds of rows per page before v17 keeps them
  until the GM trims from Codex settings. That is deliberate — silently deleting history on upgrade would be
  the destructive act the whole design avoids — but it means the default 90-minute window does not shrink an
  existing codex by itself, and a GM who never opens the settings screen will not discover the trim.

- **[codex/search] Four of the five arms of `projectPlayerSearchHit` have no test that fails when broken.**
  Measured: making the page, journal, map or marker arm unconditionally visible leaves all 224 codex tests
  passing; only the quest arm fails. The SQL layer IS covered, which is exactly why the projection's gate is
  never exercised over HTTP — `PLAYER_VISIBLE_SQL` filters the ids first. M10 applied the direct-unit-test
  discipline to the arm it added and never retrofitted the four older ones, while the file claims "Each is
  tested at its own layer for exactly that reason." Not a live leak; a load-bearing gate with no alarm on it,
  and the M6 lesson recurring in the mirror direction. (The journal arm now delegates to
  `projectPlayerJournalEntry`, so it is covered — the other three are not.)

- **[codex/store] A page that HAD standing and is re-typed away from `faction` keeps its standing row.**
  `setStanding` now requires `entity_type = 'faction'` only to CREATE a row, not to update one, and the
  Campaign card lists any page that already has a row whatever its type is now — otherwise the GM had a
  player-visible number they could neither edit nor reach (verified through the real routes before the fix).
  What remains: a standing row can sit against a character or location page if the GM re-types one. Harmless
  and repairable (zero it, unreveal it, or delete the page), but the data model no longer guarantees what the
  spec asks for. The stricter alternative — refusing to demote a faction that has standing — was rejected as
  the worse trade: it blocks an ordinary edit to protect a rule nothing depends on.

- **[codex/client] `clampStanding(Infinity)` returns 0, not 100.** `Math.trunc(Infinity)` is not finite, so
  a non-finite value falls through to the `Uninvested` centre rather than the `Exalted` end. Not reachable
  from the bounded number input; documented as intentional in the helper. Recorded because "an overflowing
  control lands on neutral" is a surprising failure direction if it ever becomes reachable.

- **[codex/audit] The published campaign date is not in the reveal audit.** It is a player-visible thing the
  GM publishes (M11's O-1), and the audit lists seven record kinds and not that. Contract-compliant — the
  seven kinds were frozen deliberately — but a GM asking "what can they see?" may reasonably expect the
  party's current date to be on that list. Raised by adversarial review as a scope observation, not a defect.

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

### Homebrew system — open items (2026-07-27)

- **[homebrew] Editing a PUBLISHED record can still demote it mid-keystroke.** `HomebrewStore.update`
  re-validates every PATCH to a published row and, when the new body would no longer publish, drops
  the row to an invisible draft in the same transaction (`apps/server/src/homebrew-store.ts`
  `stillPublishable` / the demote branch) — and the editor autosaves ~800 ms after a keystroke
  (`apps/client/src/homebrew/useAutosave.ts`). The rule itself is right; what is wrong is that a
  half-typed edit is a *published-state* event at all. The fix is the draft-until-update lifecycle
  (decision D20): a published row's PATCHes land in a `draft_body_json` column, `body_json` and
  `visible_to_players` never move, and an explicit **Update** validates and swaps. Deferred as a
  unit, deliberately — a half-built lifecycle would be worse than the current honest one. **Much
  narrower than it was:** the demotion used to fire on ordinary edits because a touched-but-
  incomplete `weapon`/`armor` block was unpublishable; those bodies now publish (see below), so the
  remaining trigger is an edit that genuinely invalidates the record.
- **[homebrew] Validity is point-in-time.** The publish gate checks a record against the world as it
  stands at that moment. Nothing re-checks **dependents** when the world changes underneath them, so
  deleting or editing a dependency can leave a dependent record published-and-invalid (`restore`
  included). The merge drops an unparseable record with a `console.warn`, so the failure is quiet.
- **[homebrew] `reminted.reason` has no honest value for "not our shape"** — the contract enum is
  frozen, so a pack id that is re-minted for shape reasons reports a collision that did not happen.
  Needs a `packages/api-contract` enum addition.
- **[homebrew] Packs have no UI** — export and import are 2 of the 13 operations, HTTP-only,
  deliberately deferred.
- **[homebrew] A caster subclass still needs its class published first** (the third-caster check
  reads the class's level table). Not a deadlock — the class side now waits for nothing — but an
  ordering a GM can hit.

### Found by the 2026-07-27 phase-5 content pass

- **[testing] The nine generated classes have prose-only features.** Only the choice-bearing ones
  (46 of 185) carry structured riders; the rest are description text, which ADR-0008 permits but
  means a Barbarian's Rage grants nothing mechanically — the resource counts are in `classResources`
  but nothing interprets them. The three hand-authored classes are richer than the nine new ones.
  Expected for a first pass; worth knowing before anyone assumes parity.
- **[content] `weaponProficiencies` gained two qualified slugs** — `martial-light` (Monk) and
  `martial-finesse-or-light` (Rogue), because the SRD grants those classes a *slice* of Martial
  rather than all of it. Flattening them to `martial` would have handed a Rogue a greatsword.
  Nothing consumes the qualifier yet, so equipment filtering by proficiency is not enforced.

### Bounded out of the 2026-08-08 built-but-unwired pass (found, measured, not fixed)

Three P1s were fixed there — the builder now mints an action per damaging CANTRIP with `spellId` set
(so Agonizing Blast reaches a real Warlock), a Monk gets a Martial Arts Unarmed Strike that Extra
Attack can multiply, and a generated character's ledger prefills a level-up like a hand-built one.
These are the pieces those fixes deliberately stopped short of, each with the reason it stopped.

- **[character-builder] Only CANTRIPS become actions; a LEVELED spell still has none, so it has no
  `spells[].actionId`, no `spellId`, and casting it from the sheet is still a client-side damage
  roll.** The blocker is the slot, and it is measured rather than assumed: an action would have to
  carry `spellSlot`, and no field on the finished sheet says which slot a spell spends. A **Warlock
  5's only slots are LEVEL 3** (`pactSlots` replaces the `spellSlots` column outright), so
  `spellSlot` taken from the spell's own level refuses a level-1 Bane the character may legally cast;
  and **Ascendant Step's Levitate** is a granted casting the SRD says costs no slot at all, yet on
  `spells[]` it is indistinguishable from a prepared one (both `alwaysPrepared`). Omitting
  `spellSlot` instead is worse: it would put a slot-free cast of every leveled spell in the Actions
  runner. Wants a per-spell "which pool pays for this" field, not a bigger `cantripActionFor`.
- **[character-builder] Cantrip damage does not scale with character level.** Fire Bolt rolls 1d10 at
  level 11 where the SRD prints 3d10, and Eldritch Blast fires one beam at 5 where it prints two. The
  content already carries the rows (`castingOptions` `player_level_5/11/17`, with `damageRoll` and
  `targetCount`), and **nothing reads them**: the sheet's `spellEffectAt` consults `castingOptions`
  only when the cast level exceeds the spell's own, which is never true for a cantrip. So the minted
  action deliberately matches the base die the sheet prints beside it — fixing one without the other
  puts two different numbers on one row. Fix both together: `spellEffectAt` and `cantripActionFor`.
- **[character-builder] Martial Arts reaches the Unarmed Strike but not MONK WEAPONS.** "You can roll
  1d6 in place of the normal damage of your Unarmed Strike **or Monk weapons**" and "Dexterous
  Attacks" both apply to Simple Melee and Light Martial Melee weapons too. Measured on a real
  generated Monk 5 (DEX 15 / STR 12): `Quarterstaff +4 (1d6+1)` — Strength, and the printed 1d8
  nowhere. The strike could be minted by the builder because the builder holds both the printed
  column and the finished scores; a weapon swing is derived at READ time by `deriveEquipment`, which
  holds no class table and so cannot know the die. Wants the die on the definition (or the class row
  reachable from the derivation), not a hard-coded "if monk" in `weaponAbilityModifier`.
- **[rules-engine] Flurry of Blows grants no swings.** Its two Unarmed Strikes now name something the
  engine can roll, but nothing grants them: `ActionSchema.multiattack` is the field that would, and
  `evaluateActionEconomy` opens a component instance only for an `activation: "action"` on the
  bearer's own turn. Declaring `multiattack` on a bonus action would look wired and hand out nothing,
  which is worse than the prose. The GM adjudicates it today through the rules dial like any other
  unmodelled economy call. Wants a bonus-action component pool.

### Deferred by the 2026-07-27 readiness pass (found, scoped, not fixed)

The polish pass was bounded to small/medium lift; these were found by it and left, each for a stated
reason. They are **findings, not unknowns** — don't re-discover them.

- **[character-builder] `patch(...)` spreads a stale `draft`** across 5 call sites. Latent, not
  currently reproducible in the wizard's own flows, but the shape is the classic one (a second patch
  in the same tick loses the first). Fixing it properly is a state-model change, not a polish edit.
- **[ui] The `→` glyph has no font coverage** — no loaded Manrope subset declares U+2192, so every
  arrow falls back. **Half-fixed 2026-08-03:** `IconArrow` exists and is exported
  (`packages/ui/src/primitives/icons.tsx`), and the landing doors and `Button arrow` use it; four
  play call sites still type the character. That mixed state is the bad one this entry warned about,
  so it stays open until the last row leaves `GLYPH_ALLOW`
  (`apps/client/src/design-conventions.test.ts`, whose sizes are pinned and shrink-only).
- **[character-builder] Skill/tool/language uniqueness is enforced client-side only.** `479cb80`
  makes held proficiencies arrive greyed with their provenance ("Already granted by Soldier"), which
  stops the silent double-spend in the UI — but the **server's duplicate guard is still per-offer**,
  so a hand-built API payload can still burn two picks on one skill. Server-side global uniqueness is
  the real fix.
- **[rules-5e] Third-caster multiclass rounding** is unverified against the SRD's rounding rule for
  Eldritch Knight / Arcane Trickster style progressions.
- **[character-builder] Step 4 is dense at high level — but no longer tall. CLOSED as a height bug
  2026-08-07; the card COUNT stands.** Measured per class 2026-07-27 (the earlier "~306 cards" figure
  was wrong — it is class-dependent): **Fighter L20 = 10 offers / 62 cards**; **Wizard L20 = 12
  offers / 467 cards**, and 467 is still what a Wizard 20 is asked to read. What changed is that the
  cards no longer set the step's height. `5c32df9`'s answered-state fix (24,222px → 1,933px) worked
  by UNMOUNTING an answered offer's grid, which the client then reported as its own defect (issue
  `1`: a player could not see what they had not chosen). The fold is gone and `ChoiceGrid bounded`
  caps each card list at 21rem instead, so both states are bounded rather than one being traded for
  the other. Re-measured 2026-08-07 in Chromium 1194 by driving the real wizard to a fully answered
  Wizard 20 features step and reading `.cb-step` scrollHeight — 14 offers / 468 cards:

  | | 1280px | 375px |
  |---|---|---|
  | arrival, before | 13,434px | — |
  | arrival, now | **3,522px** | 4,032px |
  | answered, now | **5,076px** | 5,922px |
  | answered, cap lifted | 12,766px | 32,200px |

  The answered step is now shorter than the same step used to be on ARRIVAL, so nothing in the flow
  is taller than it already was. What is left is genuinely a density question — 467 cards to read —
  and cutting that means progressive disclosure, a design change rather than a CSS one.

  **The table moved down on 2026-08-07 and the reason is the choice card, not the cap.** Issue `2g`
  re-opened (the card was double the reference control's height, and the pairing was ambiguous), and
  compacting it took ~34px off every card with a description. Same script, same browser, same
  fully-answered Wizard 20: arrival 3,705 → 3,522 at 1280 and 4,117 → 4,032 at 375; answered
  5,238 → 5,076 and 5,971 → 5,922; cap lifted 17,089 → 12,766 and 44,957 → 32,200. The two "before"
  figures at 375 are this run's own measurement of the previous commit, which is why they differ by
  a few dozen pixels from the ones first recorded — quote the pair from one run, never across two.
- **[mobile] No physical iOS/Android acceptance pass yet** — responsive layout + Pointer
  Events are built and parity is mandated (ADR-0014), but real-device acceptance and a
  degraded-browser fallback UI do not exist. `BUILD_PLAN` GAP-001. Don't claim device
  coverage you haven't actually run.
- **[api] Credential `gameId` binding is dead plumbing** — `CreateIntegrationCredentialRequest`
  accepts a `gameId`, and `IntegrationCredentialStore.verify` enforces it, but no caller ever
  passes a `gameId` through (`api-v1.ts` / `game-http.ts` wiring), so a credential minted with a
  non-null `gameId` is permanently unusable (generic 403) and `rotate` can't clear it. Predates
  the game API; harmless while everyone leaves it null (this is a single-game product). Either
  thread a real game id through verification or drop the field in a future contract pass.
  Found by architecture review 2026-07-18. **Mitigated 2026-07-18:** the credential form (now
  Settings → The table → Access & integrations) no longer offers the field, so the footgun is
  API-only; the contract keeps accepting it for now.

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
  **Re-measured 2026-08-08 on a denser case and the verdict is unchanged.** `3d` gave every
  damage-type `TagInput` a visible chooser, so thirteen chips are now thirteen taps rather than
  thirteen typed words — the wrap case is much easier to reach than it was. Probed at 375px on a
  homebrew monster carrying all 13 damage resistances plus 6 immunities: **19 ✕s across 4 wrapped
  rows, every one 44×44 with reach 45**, and the same decisive tap 10px above a wrapped row's ✕
  removed that chip's own tag ("poison"), not the row above's. Second independent non-reproduction;
  still deliberately not fixed, and `TagInput.css` is untouched by that unit.

- **[codex/store] Migration v15 is not idempotent, and its failure mode is "the codex will not open".**
  Re-running it (only reachable if its `codex_schema_migrations` row is lost) aborts on
  `ALTER TABLE codex_meta ADD COLUMN published_year` → `duplicate column name`. **Verified**: deleting the
  v15 row from a healthy database and re-initializing throws, and the file is left fully intact — no data
  loss, no stray `codex_journal_new`, all indexes present. Every migration in the file behaves this way
  (none use `IF NOT EXISTS`), so this is consistent rather than new; v15 is simply the first whose failure
  is total rather than partial. The version INSERT is inside the same transaction as the migration, so a
  crash can never record a migration that did not run. Left as-is because making one migration idempotent
  and not the rest would be the worse inconsistency.
  **2026-07-31:** v18 (`duplicate column name`), **v19** (`CREATE TABLE codex_journal_new` already exists,
  plus a duplicate synthesized-session number), v20 (`duplicate column name`) and v21 (duplicate FTS rows)
  join the total-failure class on the same terms. v19 is the one worth naming: it is the file's second
  table REBUILD, so a re-run aborts before dropping anything and the failure mode is still "the codex will
  not open, the file is intact". The posture is unchanged, deliberately.

- **[codex/chronicle] A calendar reshape can flip a revealed deadline's state from "Passed" back to
  "Approaching".** `fired` derives from `calendar_instant`, which is recomputed from the raw date on every
  calendar write; `normalizeCalendar` clamps a date's month into the new month count. **Verified**: a
  deadline dated month 1, day 25 has instant 89574; shrinking the calendar to a single month clamps it to
  44784, and a deadline the party had seen pass reads as approaching again. The raw date is preserved
  correctly and the reflow is doing exactly what K3 specifies — the flip is inherent to deriving `fired`
  rather than storing it (D11-C), which remains the right trade. Recorded because nothing else says so,
  and because a GM who reshapes their calendar mid-campaign will see it.

- **[repo/tooling] `apps/client/test/setup.ts` is outside the client tsconfig and is never typechecked.**
  `tsconfig.app.json` includes `src`, and every client test lives in `src/codex/` — so test files *are*
  checked (confirmed: widening the M11 types produced 14 errors across seven existing test files). But
  the shared setup file is not: appending `const deliberate: number = "not a number";` to it produced no
  error from `tsc`. Anything that moves into that file is invisible to `npm run check`.

- **[codex/graph] The node hover/focus ring paints on the invisible 44px hit circle.** `.codex-graph-node.is-hover circle`
  and `:focus-visible circle` are unscoped, so they stroke *every* circle in the node group — including
  M5's transparent hit circle, which is far larger than the painted node. Pre-existing (M5 added the hit
  circle; these rules predate it), spotted during M7. CI-8's new `.is-focus` rule scopes itself off the
  hit circle correctly, so the pattern to copy is already in the file.

- **[ui/Badge] `Badge tone="info"` fails AA on its own surfaces, worst in the sunset hour.** `--indigo`
  (#5B6EF5 dark / dusk) as 11px/700 text measures **3.57:1 on dark `--surface-3` (#292145)** and
  **2.45:1 on dusk `--surface-3` (#443381)**; light is fine at 5.36. Measured in Chromium 2026-08-04 by
  sampling the composited pixel behind the live badge on `/settings` (the *Advise* rules badge is the
  reachable instance). Pre-existing and provably unrelated to the scene sky: sampled with the sky
  removed the numbers are byte-identical, because the badge stands on an opaque surface token.
  `--indigo` has no readable `-hi` twin the way `--danger`/`--caution` do, which is the actual gap —
  D21 #1 fixed exactly this shape for `--text-muted`.

- **[ui/Button] `.nh-btn--destructive`'s label fails AA in daybreak, and the sky takes it 0.14 lower.**
  The light `--danger` ink `#E24C6C` on the settings glass measures **3.48:1** at 1440×900 and
  **3.49:1** at 390×844 (GM `/settings`, the *Revoke all GM sessions* control, region scrolled to its
  end), against a 4.5 floor. Night reads 6.78 and the sunset hour 5.16, so daybreak alone is under —
  the light `--danger` token is the defect, not the button. **It was under before the sky:** measured
  in the same frame with the sky removed it reads 3.62, so the scene contributes −0.14 and the
  remaining 0.88 is the token's. The delta is logged so the token fix is sized against the
  COMPOSITED value rather than the flat one; this was the only row in the lane's contrast sweep
  where the sky moved a ratio *and* the result was below AA. Same shape as the two entries around
  it: a hue with no readable twin in one theme.

- **[scenes] `.scene-live-note` ("● Live now") measures 4.07:1 in the sunset hour.** `--magenta`
  (#FF2E9A) as 11px/700 text on dusk `--surface-1` (#2E2160); dark reads 5.32 and light 5.17, so dusk
  alone is under. Same measurement run and the same proof of independence as the entry above (identical
  with the sky removed — an opaque card, not the sky). The label is not colour-alone (it carries the
  word "Live"), so this is a contrast defect rather than a semantics one.

- **[codex/ui] An open `Drawer` paints over the shell behind it, the control that opened it included.**
  Re-measured 2026-08-05 at both widths on the GM's `/codex`, by the same method
  `scripts/tap-audit.mjs` uses for its layer split: scroll each control to the viewport centre, then
  ask `elementFromPoint` what answers there. At **375px** the session-prep panel is
  `min(420px, 85vw)` — 318.75px, anchored right (`apps/client/src/codex/codex.css:1174`) — and **27 of
  the 30** hit-testable controls under `.codex-root` answer with the drawer. The three that do not are
  its own Close and "Open Sessions" plus the top-left "Codex sections" button, which survives only
  because it sits in the 56px strip the panel leaves. The nav drawer is the full 375px and covers **28
  of 43**; the player's drawer covers **19 of 30**. At **1280px** the same panel is 420px on the right
  and covers **18 of 43** — less of the shell, but still the opener: at both widths the "Session prep"
  button reports `aria-expanded="true"` while its own centre resolves to `.nh-drawer-body`, so a second
  press is intercepted and the open-drawer count stays at 1.
  **This is the primitive's design, not a touch-target defect.** `packages/ui/src/primitives/Drawer.tsx:24-34`
  states there is deliberately no scrim, no focus trap and no scroll lock — so a non-modal console can
  sit beside a working view — and a panel that paints over the shell follows directly. Nor is it a
  trap: Close is visible and carries `aria-label="Close"`, and Escape with focus inside leaves 0 open
  drawers at both widths. What is open is the UX question underneath: at a width where the panel takes
  85% of the screen and leaves one shell control reachable, should it become a `Modal` — or should the
  opener stop presenting itself as a toggle it cannot untoggle?

- **[codex/verify] `scripts/tap-audit.mjs` withholds its reach verdict for every control outside the
  active layer — and never opens some layers at all.** At HEAD (2026-08-10) the footer at 375px reads
  **2131 controls measured, 30 below the 44px floor, 1 unreachable in the active layer, 3 surfaces
  NOT MEASURED** — it read 1223 / 9 / 0 on 2026-08-05, before the play shell's surfaces were walked.
  Reach is
  *not judged* for the controls that sit behind an open overlay (a modal `<dialog>`, which the
  platform makes inert by spec, or an open non-modal `Drawer` — the entry above) or inside a closed
  `<details>`. They are still sized and still counted in the below-floor total; only the reach verdict
  is withheld, so nothing measures whether they are reachable once their own layer becomes the active
  one. That is the gap.
  **The split is quoted with its provenance, because this entry once carried a stale one as if it were
  current.** Re-measured 2026-08-10 at HEAD: **541 unjudged — 508 behind an open overlay, 33 inside a
  closed disclosure**, against `765e232`'s 184 (130 / 54). The population moved with the play shell,
  so quote the pair from one run and never across two. (The numbers this entry used to quote — 187
  unjudged of 1259 measured, 124 below the floor — were a phase-opening snapshot, and 187 was
  `765e232`'s 184 mis-added as 130+57.)
  **A second, larger blind spot is the state the audit opens a surface IN.** "30" means thirty on the
  surfaces its route list opens, as it finds them. Controls behind a collapsed tab or a closed
  disclosure are never measured at all: `.dice-custom > summary` x2 at 19.5x375 (the phone sheet
  mounts one tab's body at a time and the audit only ever measures the default tab) and
  `button.api-copy` at 27.3x48.9 inside a closed `details.api-reference` on `/settings`. Both are
  pre-existing and both are real sub-floor controls that would raise the 30 if the audit drove them,
  as would the seventeen in the `[ui/touch]` row-tools/token-menu entry above.
  This entry used to blame the old "unresolved" column on SVG children and on controls that could not
  be scrolled to the viewport centre. **Both causes measure zero.** SVG controls resolve —
  `g.encounter-token` walks out to reach 21 against its own 15.8px box, `g.codex-graph-node` to 29-31 —
  and each control is scrolled to the centre before hit-testing (`scripts/tap-audit.mjs:185-187`). The
  "25-59 per surface" range this entry quoted described a column that no longer exists.

- **[content/vocabulary] Three rider gaps Stage 4 lane B4 hit and authored around, each blocking a
  record that would otherwise be sayable.** All three are authoring limits, not defects in shipped
  behaviour, and each has a record standing on it today:
  (1) **Wizard's Spell Mastery is still authored as ONE `choice`** — "choose a level 1 AND a level
  2 spell" ships as a single pick with `maxSpellLevel: 2`, so a Wizard may take two level-1 spells.
  The limit that forced it is gone: `overlay.ts`'s `FeatureMechanics` carries `choices` in both of
  its unions and the homebrew editor authors the plural form (U12, 2026-08-09), so the record can
  now be re-authored from `wizard.ts`; it has not been.
  (2) **`ExtraDamageVariantSchema` requires `damageType`** and has no "same type as the triggering
  damage" form, so Evoker's Empowered Evocation ("add your Intelligence modifier to one damage roll
  of any Wizard Evocation spell") has no correct type to author — Fireball is Fire, Lightning Bolt is
  Lightning.
  (3) **Two rider filters are authorable but have no producer, so they fail closed.**
  `RiderContext.spellSchool` is declared in `packages/rules-5e/src/riders.ts` and set by nothing, so
  `spell-school-is` never matches; and `attackKindsOf` in `apps/server/src/action-resolution.ts`
  derives melee/ranged/thrown/unarmed/reaction and never "spell", so `attack-kind-is: ["spell"]`
  never matches either. Both would ship inert if authored, which is why Innate Sorcery's advantage
  and Empowered Evocation stay prose.

- **[server/test] `typed-damage-feed.test.ts`'s two reaction cases fail at random, roughly once in
  a few dozen full-suite runs.** Both `explains the halved reaction damage when the reaction is USED`
  and its sibling `... when the reaction is DECLINED` have each failed once, on different runs, for
  three different agents on 2026-08-09. **Running the file alone does NOT clear it, and the entry
  used to say it did** — "5 consecutive clean runs of the file at `7d386d9`" was a small sample, not
  a property: measured again at `13656ca`, the DECLINED case failed **1 of 3** isolated runs of the
  file on its own. So isolation is evidence about the rate and not a test that distinguishes flake
  from regression; run it several times. The fixture's bite rolls an **unseeded** `4d6 + 6`
  (`apps/server/test/typed-damage-feed.test.ts:56`) and both cases then assert a feed string built
  from whatever it rolled, so the assertion's expected text changes run to run. The mechanism past
  that is **not proven** — do not treat a red run here as a regression until you have re-run the file
  alone several times. One asymmetry worth checking first: the USED case guards the parked prompt with
  `expect(prompt, "the bite parked no reaction prompt").toBeDefined()` and the DECLINED case
  dereferences `prompt.proposedDamage` with no guard, so if the bite can ever fail to park a prompt,
  the two cases fail differently. Fix: seed the roll, or force the dice the way
  `warlock-sorcerer-wizard.test.ts` does.

## Unverified — needs a browser, a contrast check, or a runtime repro

These entries could not be confirmed *or* refuted by reading the code, so they are held here
rather than deleted: each one asserts a rendered measurement — a laid-out box, a computed
contrast ratio, a synthesized pointer event — and no static check can settle any of them.
They are **open questions, not claims that anything works.** Before acting on one, reproduce
it: `node scripts/tap-audit.mjs 375` for a touch-floor claim, `scripts/browser-verify.mjs`
for a layout or pointer claim, a contrast calculator against
`packages/ui/src/styles/design-tokens.css` for a ratio. If it reproduces, move it up to
*Known gaps* with what you saw. If it does not, delete it and say so.

- **[repo/tooling] A pin cannot be selected reliably by a synthesized click at 375px.** `MapSurface`
  resolves a tap from `pointerdown`/`pointerup` on the whole `<svg>` (so it can tell tap from drag from
  pan), so `dispatchEvent("click")` does nothing and a plain Playwright click fails the "receives
  events" check; `click({ force: true })` works at 1280px. At 375px it is unreliable, and the cause is
  already in this file: the closed session-console drawer stretches the initial containing block, so
  `getBoundingClientRect` and pointer coordinates disagree — measured on 2026-08-01 as four consecutive
  pins reporting the same viewport box. **The failure mode is expensive**: a half-selected pin with
  autosave off leaves a leave-guard registered, which then refuses every later in-app navigation
  (Playwright dismisses an unhandled `confirm`, and dismiss means "stay"), so one flaky check produced
  nine false failures before it was understood. The browser pass therefore runs its two pin checks at
  desktop only and says why; pin reachability on a phone is the tap audit's job, where it is measured
  rather than clicked.

- **[a11y] `--text-muted` fails AA at small sizes** (3.61:1 dark) — affects `.nh-choice-meta`,
  `.nh-statlist dt` and dozens of app labels. Pre-existing, not introduced by the builder work;
  deliberately not retuned mid-flight. Needs its own pass.

- **[a11y] `.nh-step--done` check glyph is 1.97:1 against its own fill in the light theme.**
  Recomputed independently from the tokens 2026-07-27 — the figure is exact, but two refinements
  matter. The glyph is an `aria-hidden` SVG with the state also in an `nh-sr-only` label, so the
  applicable rule is **1.4.11 (3:1)**, not 1.4.3; and the marker's **border** (`--cyan` on `--bg`)
  measures a **passing 3.85:1**. So the done state stays distinguishable — what fails is the glyph
  inside it. A real 1.4.11 failure, lower severity than "state invisible". Dark theme is 9.07:1.
  (While measuring: `.nh-step--incomplete` light = 3.91:1, passes. Pre-existing near-miss not from
  this pass — the *upcoming* marker's number is real text at 4.47:1, marginally under 4.5:1.)

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

## Gotchas that look like bugs (but aren't)

- **[encounter/ask] A parked question survives the turn advancing, and a late Allow resolves the move
  out of turn.** Driven 2026-08-05: with the question waiting, "Next turn" moved the fight to the next
  character and left the row on both screens; the GM's Allow then rolled and applied the parked Dagger
  for the previous character. That is the design, not a leak — nothing expires the queue on advance, the
  replay runs under GM authority with an injected override, and "not your turn" is itself an overridable
  economy rule. A combatant **cannot** leave a running fight (`actor:remove` refuses with "End the
  encounter before removing a combatant who is in it"), so the parked target cannot vanish underneath the
  question; the failure branch that remains is a question already answered, covered by
  `apps/server/test/rules-ask.test.ts`.

- **[codex, viewer safety] Auto-linking a session number to players is fixed, twice over —
  do not re-solve it.** A revealed record must not carry an unrevealed session's number, and both
  the projection and the linker enforce it now. The full history and the reasoning are in
  `docs/archive/ai-ledger/known-bugs-resolved-2026-08-01.md`; re-deriving the fix from scratch is
  how a solved viewer-safety problem gets re-opened.
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
designed but surprising, it belongs under **Gotchas** so nobody "fixes" it by accident. If it
needs a browser, a contrast calculator or a runtime repro before anyone can say, it goes under
**Unverified** with the reason. **Nothing fixed stays in any of the three** — delete it, and
let the regression test carry the memory.

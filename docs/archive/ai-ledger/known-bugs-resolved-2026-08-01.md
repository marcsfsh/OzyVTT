> ## ⚠ ARCHIVED — 2026-08-01
>
> **What this is:** Resolved, duplicated and refuted entries lifted out of `docs/ai-ledger/known-bugs.md`, whose own rule at the top of the file says to remove an entry when it is fixed.
> **Current through:** 2026-08-01  (last commit that kept it true: `706eab5`)
> **Superseded by:** `docs/ai-ledger/known-bugs.md` — every entry that remains there is reproducible at HEAD.
> **Read this for:** the reasoning behind a non-obvious fix, and what a defect looked like before it was understood.
> **Do not read this for:** what is broken now. Nothing here is open. The test that covers a fixed bug is its real record (D9).
> **Paths, line numbers and counts inside this file are as of the date above and are not maintained.**

## Resolved entries

Thirty entries lifted out of `docs/ai-ledger/known-bugs.md` on 2026-08-01, unchanged. Each was
either **self-declared fixed** in its own headline, or **verified fixed at `706eab5`** against the
code while still filed as open, or a **duplicate or a superseded correction** of another entry.
The two counts that circulate for this file measure different things and both are reproduced
here so neither is mistaken for the other:

- **18** entries declare a fix in their own headline. That is what the freshness check counts,
  and it is why none of them may remain in the live list.
- **12 more** were filed as open and are false at `706eab5`. A static check cannot find these —
  "is this still broken?" is a question about behaviour — so they were read and verified one by
  one, with the code location that refutes each.

Nothing here is open. The regression test that covers a fixed bug is its real record (D9); this
file exists for the reasoning behind a non-obvious fix, and for what a defect looked like before
it was understood.

**Verified-false-at-HEAD, with what refutes each** (the twelve that did not announce themselves):

| Entry | Refuted by |
| --- | --- |
| `GET /codex/export` has no restore path | `POST /codex/import` → `store.importBundle` (`apps/server/src/codex-http.ts`) |
| `GET /codex/export` documents a round-trip that does not exist | same route; the round trip exists |
| The committed tap audit cannot see five of the surfaces | `scripts/tap-audit.mjs` is route-driven now (`SURFACES` / `PLAYER_SURFACES`), and covers sessions, quests, the reveal audit and the session-prep drawer |
| A revealed unnumbered session with an empty recap renders a blank audit row | `sessionDisplayTitle` (`apps/server/src/codex-projections.ts`); duplicate of the FIXED entry 41 lines below it |
| The Graph's sub-floor node count is data-dependent, not 3 | a correction record about a number, superseded by the current measurement in the live entry it corrected |
| Phase-2 gating items (three of them) | all three shipped: `fromCatalog` resolves server-side (`apps/server/src/character-build.ts`), `GameState.builderPolicy` + `builder.set-policy` model decision 10, and the wire shapes carry proficiencies, `multiclassPrerequisites`, `abilityBonuses` and the `spellListId` ↔ `classes` link (`packages/domain/src/index.ts`, `apps/server/src/content-library.ts`) |
| No `ClassReference` → `ClassProgressionTable` adapter | `progressionTableFromClasses` via `library.classProgressionTable()` (`apps/server/src/content-library.ts`, `character-build.ts`) |
| No feature-rider interpreter | `interpretFeature` (`apps/server/src/character-build.ts`) |
| `skills.v1.json` prints "Sleight Of Hand" | the bundle prints "Sleight of Hand" |
| `--caution-hi` IS `--violet-hi` in all three themes | ruling R8 / D21 made `--caution` a warm orange (`packages/ui/src/styles/design-tokens.css`) |
| `h1, h2, h3 { font-weight: 400 }` in `apps/client/src/styles.css` | no such rule remains in that file |
| The campaign's current in-world date reaches players | duplicate of the entry resolved by M11 / owner decision O-1; the player clock is now separate (`getPublishedDate`, `apps/server/src/codex-store.ts`) |

---

- **[codex/shell] Collapsing the sidebar was a ONE-WAY DOOR — FIXED 2026-08-01.** The collapse toggle
  was rendered only when `!collapsed`, and `collapsed` is `railBand || sidebarMode === "rail"` — so the
  control hid itself the moment it was used, and because the preference persists to localStorage a
  reload did not bring it back. `setSidebarMode` has one call site, so nothing else recovered it: the
  GM was in the rail until they cleared site storage or resized past 850px. Gated on `railBand` now
  (which is what the comment beside it always claimed), so the forced 761–849px band still hides it —
  there is nothing to expand into there. The player gained the same affordance on its own key (D1: the
  sidebar is collapsible, and the player's mirrors the GM's minus GM *tools*), never inside the GM's
  embedded preview. **Found by the client, in minutes, by using the app** — after 47 QA agents, two
  browser passes and a tap audit. **The lesson, which is bigger than the line:** every automated check
  this repo owned verified that things are REACHABLE, and not one collapsed a control and tried to get
  back. `sidebar-rail.test.tsx` now drives it both ways (including across a reload) and the browser
  pass has a both-directions check over three toggles.

- **[codex/atlas] Switching to another PIN did not pass the autosave-off leave guard — FIXED
  2026-08-01.** The selection is the ADDRESS now (`AtlasView`'s `selectPin` → `onNavigate`), which is
  what D3 always said `?pin=` was, so it goes through the one guarded path: it prompts with autosave
  off and a dirty draft, survives a refresh, and Back closes the inspector. Deleting a pin still clears
  the selection without a prompt (`replaceQuery` — there is nothing left to save), and the pin filters
  on the same address are carried through a selection rather than dropped. `pin-selection.test.tsx`
  proves all three arms fail without it; the browser pass proves the real `window.confirm` half at
  1280px. Original report: the selection lived in `useState`, so nothing navigated, the guard was never
  consulted, and an unsaved pin label was lost silently where the same act on a page or a quest
  prompted.

- **[codex/lists] The Sessions and Quests filters lived in component state — FIXED 2026-08-01.** Both
  read `?q=`/`?status=` and write through the shell's one filter writer (`setListFilter`, which the
  Journal now shares), so all five GM lists behave alike: a filtered log is linkable and survives a
  refresh. **What remains, uniformly and by design:** opening a RECORD from a filtered list drops the
  filter from the address (`navigate(sessionPath(id))` carries no query), exactly as Pages has always
  done. Back returns to the filtered list, because that address is the previous history entry. Pinned
  as the current answer in `list-filters.test.tsx` rather than left to be re-discovered — making the
  filter ride the record address is a change to all five lists and a design call about how long a
  filter should stick.

- **[codex/palette] "New session" and "New quest" only NAVIGATED — FIXED 2026-08-01.** Both create now,
  through one shared `creates.ts` that the Sessions and Quests rails call too, and both land on the new
  record. The two "Log …" rows still navigate and are named for what they are: a journal entry and a
  downtime record are composed in a form, so their door is the surface holding the form.
  **Still open, pre-existing:** every verb and goto is gated on an EMPTY query
  (`CommandPalette.tsx`), so no section can be reached by typing its name, which makes a twelve-item
  goto list harder to use than it should be. Not touched here — it is a search-ranking change (verbs
  would have to compete with record hits), not a wiring fix.

- **[codex/player] The player's lists had no in-place filters — FIXED 2026-08-01.** All five now match
  the GM's, in the same words and on the same parameters, held in the address: Pages gains kind + tag
  (settable and clearable in place, not only by a dashboard card), Sessions a text filter, Quests text
  + status, the Journal the GM's kind/text/tag row, and the Atlas the GM's pin filter (dimming, not
  hiding). Inside the GM's embedded preview they drive the preview's own local address and never the
  browser's, which `list-filters.test.tsx` and the browser pass both assert.

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

- **[repo/tooling] The committed tap audit cannot see five of the surfaces this programme added.** Its
  `MODES` loop visits the five mode tabs only, and switching mode closes the destinations — so the Sessions
  log, Quests log, Reveal audit, session console drawer and standing dialog have never appeared in a reported
  number. The final QA pass measured all five separately (0 sub-floor, 0 stolen taps at 375 and 320), but the
  script should learn the ops row so the claim stays checkable without hand-written harnesses.

- **[codex/audit] A revealed unnumbered session with an empty recap renders a blank audit row.** Same defect
  the M12 remediation fixed for journal rows with `AUDIT_JOURNAL_FALLBACK`, left in place one arm over
  (`codex-projections.ts`, the session arm). A row with a Hide button and no label, on the screen whose job is
  saying what the party can see.

- **[codex/audit] A session with no number and no recap rendered a BLANK audit row — FIXED 2026-07-31.**
  The audit's session arm fell back to `excerpt(recap)`, which is `""` for an empty recap, so the row was
  unreadable and unclickable. It now uses `sessionDisplayTitle` — number, else recap excerpt, else
  **"Untitled session"** — the `AUDIT_JOURNAL_FALLBACK` rule applied one arm over, and shared verbatim
  with the new session search hit so the two surfaces call one thing one name.

- **[codex] Renumbering a session orphans its entries and republishes numbers the player gate was
  hiding — FIXED 2026-07-31 (Codex overhaul, D9, migration v19).** Resolved by an option beyond the three
  listed below: journal entries now join their session **by id**, so the display number is resolved live
  from the linked record. Renumbering moves every one of its entries in one `updateSession` with no
  journal write at all, the by-session lens never loses the group, and the player gate keys on the
  session's reveal state by identity rather than on a list of numbers — so an unnumbered hidden session
  is gated too, which the number list structurally could not do. Session **delete** keeps the documented
  behaviour under director ruling R2: SET NULL on the join, with the number stamped back as a bare label
  only when the deleted session was revealed (a hidden one leaves no label, because a bare label passes
  through to players). Original report and the three options considered follow.
  The join
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
  CODE (twice over); entry kept for the reasoning. Do not re-solve this.** Option (2) shipped first:
  `playerSessionNumbers` resolved `store.unrevealedSessionNumbers()` once per request and
  `projectPlayerJournalEntry` nulled the number when a session record carried it and was not revealed.
  **Superseded 2026-07-31 by D9** (migration v19): entries join their session by **id**, the context is
  now `unrevealedSessionIds()`, and `projectPlayerJournalEntry` nulls **both** `sessionId` and
  `sessionNumber` together for an unrevealed session. That is strictly stronger — the number list could
  not gate an entry filed under an *unnumbered* hidden session, because such a session has no number to
  put in the set. Bare labels with no record behind them still travel, and after v19 the only ones that
  exist are those `deleteSession` stamps back for a session that was already revealed (ruling R2).
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

- **[codex] `GET /codex/export` documents a round-trip that does not exist.** `CodexExportData` is
  described as "round-trips via the codex import surface", but no route ingests a bundle — the client's
  Import reads `.md`/`.txt` files and creates pages. The export is a one-way backup. Pre-existing.

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

- **[content] `skills.v1.json` prints "Sleight Of Hand"** (capital "Of"); the SRD prints "Sleight of
  Hand". Harmless but now visible, because the sheet renders the catalog's `name` verbatim instead of
  title-casing the id. One-row data fix.

- ~~**[ui] `--caution-hi` IS `--violet-hi` in all three themes**, and in light `--caution` is literally
  `--violet` (`#7A3FD0`). The "violet is reserved for GM-only" rule is violated by the caution token
  itself.~~ **FIXED 2026-07-31** by D21 / director ruling R8, Codex overhaul. `--caution` is a warm
  orange in all three themes (`#FF9E4A` / `#FFB877` on dark and dusk, `#B4560A` / `#8F4406` on light,
  each measured against WCAG 2.1 in `design-tokens.css`), so violet again means GM-only and nothing
  else. `design-language.md` §2 records the exception to the "no yellow/orange" restraint rather than
  leaving the doc forbidding the colour that shipped.

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

- **[ui] `h1, h2, h3 { font-weight: 400 }`** in `apps/client/src/styles.css` reaches 32 app-side
  sites, including the Bungee wordmark, which the browser then renders faux-bold. App-wide typography;
  out of scope for a builder pass.

- **[ux] ~~Maps/scenes/encounter IA redesign~~ — RESOLVED 2026-07-22 (scene-centric IA, this PR).**
  The upload → browse → prepare → start experience was rethought scene-first: a new **Scenes** hub tab
  is the prep home (a gallery of scene cards — thumbnail, LIVE/staging badge, go-live, private staging,
  duplicate, drag-reorder, rename, remove); the standalone **Map Setup tab was retired** (its library +
  3×3 calibration fold into the hub via "Manage maps"); **going live also presents the scene's map to
  the shared screen**; and the Encounter tab starts combat on the live scene's map. See
  `docs/product/scene-centric-ia.md` and `docs/archive/ai-ledger/session-history.md` (2026-07-22). Remaining polish (not
  blocking): persisted server thumbnails; the Encounter quick-switch strip could slim further; a
  physical touch-device pass.

- **[api] ~~Public API drift~~ — closed 2026-07-18 (PR F on `claude/open-api-core-m75t9d`).**
  EVERY game command is now reachable over `/api/v1` (see `current-state.md`) — combat core plus
  scenes, character claims, token cosmetics, and HTTP player-session issuance. Nothing is
  socket-only anymore; Socket.IO remains the push channel, HTTP the pull/command channel.

- **[RESOLVED 2026-07-31, Lane C] [codex/client] The client's `dateToInstant` did not clamp the day to
  its month's length; the server's `calendarInstantOf` does.** Fixed by clamping inside `dateToInstant`
  at BOTH ends, which is the fix this entry named. The Calendar view (D17) reads it on every cell, so
  leaving it would have put the disagreement on screen rather than only in the Today marker. Original
  entry follows.

  > **[codex/client] The client's `dateToInstant` does not clamp the day to its month's length; the
  > server's `calendarInstantOf` does.** `normalizeCalendar` stores a `currentDate` day above the month's
  length verbatim (it clamps only at the bottom), so the state is reachable, and the two then disagree by
  a day. **Measured, not theorised**: with the clock on day 31 of a 30-day month, a 5-day downtime has the
  server landing on Alturiak 5 while unclamped client arithmetic reaches Alturiak 6. M11 is not exposed —
  `downtimeProposedDate` hand-clamps before calling it, and the Confirm row now names the server's date
  regardless — but `dateToInstant` still drives the timeline's Today marker and its year grouping, which
  are unclamped. The real fix is to clamp inside `dateToInstant` itself (or to clamp `currentDate`'s day
  in `normalizeCalendar`, which is the lossy write underneath). Both change existing behaviour beyond
  M11's scope, so both were deliberately left.

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

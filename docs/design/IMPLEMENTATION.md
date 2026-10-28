# Redesign implementation contracts

Audited 2026-10-23 against branch `claude/friendly-babbage-g7gcge`, commit
`e8e90a3038f55ad55d9f15f5022aa566f36931d9`. This is an implementation handoff for the approved design, not a request
for another design pass. Read only the phase section needed next. Source files below are navigation anchors.

## Authority and baseline

- `CLAUDE.md` and applicable repository rules govern implementation. Preserve server authority and audience projections.
- This document and ADR-0037 define dependencies, behavior and phase boundaries. DESIGN.md defines the visual system;
  the paired HTML mockups provide concrete visual values. Production accessibility and visibility constraints apply
  even where a static drawing omits them. Do not copy sample game values, anonymous placeholders or static ARIA into runtime.
- The ZIP is an overlay, not a runnable app. Install its docs and avatar assets in the existing checkout. It includes
  the opening prompt as `claude-code-opening-prompt.md`. Do not add the ZIP itself to the repo.
- Record `git rev-parse HEAD` before starting. If HEAD has advanced, check only changed files in the phase's source
  area and the relevant contracts below. A newer SRD/API implementation stays authoritative for behavior; do not
  restore old code or repair unrelated WIP to match this audit. Report baseline failures separately from regressions.
- Node 24+; install with `npm ci`. The client directory is `apps/client`, but its workspace is **`@vtt/web`**.
  UI-kit tests use `@vtt/ui`. The correct narrow example is `npm test --workspace=@vtt/web -- turn-order`.
- No changes to server code, shared domain/schema/API contracts, rule calculations or stored game data in phases 0-7.
  Client code may call existing commands and reads. New device-local preferences and visual derivations are allowed.
  If a newly discovered requirement needs a server contract, document it under phase 8 and continue independent work.

## Phase 0: install and establish checks

1. Confirm that `docs/DESIGN.md`, `docs/adr/0037-arcade-cabinet-redesign.md`, this file, all 46 view/theme references plus their HTML index and all
   32 SVG avatars are present. The opening prompt can remain outside the checkout. REDESIGN-KIT.md from the ZIP is an
   installation note; do not overwrite the repository's README.md with it.
2. Add ADR-0037 to `docs/adr/README.md`, with its design-approved, implementation-pending status. Do not rewrite historical
   ADRs. Record that 0037 supersedes the visual/layout portions of 0030/0031/0033/0035/0036; their behavioral decisions stay.
3. Add `docs/design/mockups` to `.prettierignore`. The drawings are static references; avoid a large formatting diff.
   Run `npm run format`, `npm run format:check`, `npm run lint`, `npm run check` and `npm test`. Review the diff and
   retain only intended formatting changes. Record failures that were already present before the overlay.
4. This package supplies no app implementation. Future acceptance criteria are requirements, not evidence of passing tests.

## Phase 1: themes, tokens and fonts

Source anchors: `packages/ui/src/theme/theme.ts`, `themes.test.ts`, `colour.ts`, `styles/design-tokens.css`,
`styles/fonts.css`, `apps/client/{index,sheet,viewer}.html`, `apps/client/src/shell/theme-switch.test.tsx`,
`apps/client/src/settings/DeviceSection.tsx`, `settings/preferences.ts`, `settings/sections.ts`,
`apps/client/src/styles.css`, and the UI theme primitives exported by `packages/ui/src/index.ts`.

Theme startup, identically in TypeScript and each no-flash script:

| Stored `vtt.theme`               | Render                                       | Writeback                   |
| -------------------------------- | -------------------------------------------- | --------------------------- |
| `dark`                           | `dusk`                                       | Best-effort `dusk`          |
| `light`                          | `dawn`                                       | Best-effort `dawn`          |
| `dusk` / `dawn`                  | Same value                                   | None required               |
| Missing / invalid / inaccessible | Dawn if system prefers light, otherwise Dusk | No explicit choice required |

A failed writeback must not change the resolved theme. Keep the existing key. Update `THEMES`, `THEME_NAMES`, switches,
theme-specific selectors, `color-scheme` and theme-color metadata consistently. Test blocked storage and unavailable
`matchMedia`. Add test coverage for the HTML decisions as well as React; the current theme tests assume four themes.

Token additions with exact names:

| Token                                                                                                     | Contract                                                |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `--glass-bg`                                                                                              | Dusk `rgba(18,20,34,.7)`; solid fallback `--bg`         |
| `--glass-void`                                                                                            | Dusk `rgba(10,12,22,.55)`; solid fallback `--void`      |
| `--glass-surface-1`                                                                                       | Dusk `rgba(26,29,46,.62)`; solid fallback `--surface-1` |
| `--glass-surface-2`                                                                                       | Dusk `rgba(44,48,72,.5)`; solid fallback `--surface-2`  |
| `--glass-surface-3`                                                                                       | Dusk `rgba(60,66,96,.45)`; solid fallback `--surface-3` |
| `--sky`                                                                                                   | Dusk gradient in DESIGN.md; Dawn `var(--bg)`            |
| `--grad-horizon`                                                                                          | Mockup's 2px horizon gradient; theme-specific stops     |
| `--party`, `--hostile`, `--hp`, `--hp-text`, `--hp-lost`, `--lamp-bonus`, `--primary-edge`, `--grid-neon` | DESIGN.md table                                         |
| `--focus-ring`, `--state-on-edge`                                                                         | `var(--cyan)` in Dusk, `var(--cyan-hi)` in Dawn         |
| `--font-script`                                                                                           | `"Mr Dafoe", cursive`                                   |

Dawn and reduced transparency alias each glass token to its corresponding solid. Put blur on a bounded outer plate,
not every nested `section` or `main`. Unsupported backdrop-filter also falls back to solids. Add the missing Reduce
transparency Device preference: `vtt.reduce-transparency` uses `on` / `off`; combine it with the OS media query using
OR. Initialize it for the main app, standalone sheet and viewer; use one shared preference implementation rather than
three independent stores. Entry scripts may repeat only the small startup decision. Reduction disables blur
and decorative glow. There are no scanlines over the app (ADR-0045 retired the overlay and the skeleton's sweep).

Keep existing semantic tokens working while their callers migrate. Alias `--indigo` to party and `--danger` to hostile;
update `--turn-*`, `--grid-line`, `--primary-*`, `--state-on-*`, heading shadows and old sky/landing effects as needed.
Do not leave late four-theme overrides at the bottom of the stylesheet overriding the new root. Remove old lips and
rims after their callers move; border-width tokens become zero and paint tokens become none, as appropriate to type.
Use dedicated tokens for other mockup paints, including token-name plates, chrome, tags and arrival art. No raw paint
literals in production component CSS. Avatar/map art retains its own palette.

Keep Bai Jamjuree weights 500/600/700 and Bungee 400, add VT323 400 and Mr Dafoe 400 with `@fontsource`, keep Space Mono
for the API reference, and update `package-lock.json`. Remove Tomorrow only when all its callers have migrated.
The mockups' Google Fonts links are preview conveniences; production remains self-hosted and works on a LAN.

Theme-test changes must update root ownership, retired theme/warmth assumptions and obsolete `--sky-wash` checks.
Keep existing 4.5:1 text and fill-label tests and >=30 CIE76 hue separation. Check essential edges at >=3:1 using
`--state-on-edge` and `--focus-ring` against adjacent surfaces; the cyan fill may have a distinct edge. Add HP text.
The existing `parseColour` ignores alpha: extend test-side compositing for glass rather than treating rgba as opaque.
Glass over other translucent plates must be checked in the browser too. Do not claim the old precise glass minimum
without reproducing the actual background stack. Preserve legible labels when dimming acted portraits.

## Phase 2: primitives and pictures

Source anchors: `packages/ui/src/primitives`, `packages/ui/src/index.ts`,
`apps/client/src/tokens/tokenImages.tsx`, `scene/{tokenGlyph,MapToken}.tsx`, `actors/actor-display.ts`,
`table/numbering.ts`, `packages/domain/src/views.ts`, `apps/server/src/projections.ts` (read only).

The UI kit stays independent of game/domain packages. Give primitives plain typed display props. A client adapter
extracts only data already present in the viewer's projection. Export the new primitives and asset resolver from
`@vtt/ui`. Bundle SVG assets with explicit imports or static `new URL(..., import.meta.url)` entries; no runtime
filesystem fetch and no public-URL assumption about `packages/ui/src`. External SVG images avoid duplicate inline
`defs` IDs; if inlining, namespace every ID and its references per instance.

Avatar precedence: successfully loaded authorized `tokenAssetId` art; structured visible character classes; general
actor-id fallback. A loading or failed asset uses the fallback, not a broken image. GM definitions come from the GM's
existing definition list; player definitions come only from that actor's `definition.character.classes`. Do not fetch
missing definitions to improve an avatar. `classLine` is display text, not a stable class identifier: do not parse it.
Highest-level class wins, ties use the first entry of the identity's classes array. An unrecognized winning class uses
the general fallback. A viewer who lacks structured classes may see a different picture from the GM. The current TV
feed has no classes and initiative entries have no artwork: use token metadata already in that feed when available,
otherwise the actor-id fallback. Do not widen a projection just to force identical portraits.

Deterministic general picks: use this fixed order of 19 filenames, excluding `.svg`:
`horizon, moonrise, palm, d20, blades, claws, orbit, pyramid, bolt, cassette, shades, joystick, gem, flame, waves,
pines, horns, paw, vortex`.
Hash the actor ID's JavaScript UTF-16 code units with unsigned FNV-1a: start at 2166136261; for each code unit XOR it
into the hash, then `hash = Math.imul(hash, 16777619) >>> 0`; index `hash % 19`. Do not normalize an opaque ID.
Lock order and representative IDs in tests. Do not hash a definition ID or name. Static is reserved, unused unless a
future projection explicitly supplies an anonymous-identity state. Hidden actors stay absent from audience lists.

Visual controls with smaller faces still require >=44px hit areas, including the 46x26 switch, 42px primary, chips
and segmented options. Hit areas must not overlap. Keyboard labels, focus, toggle semantics and reduced motion are
part of the primitive tests. For LifeBar, health bands, maximum zero and temporary HP follow DESIGN.md. Decorative
segments are hidden from assistive technology; one accessible label announces health. No fabricated numbers.

## Phase 3: navigation and shell

Keep existing URLs and change their grouping. This is a client implementation decision that preserves the finalized
navigation while avoiding unnecessary URL migration. Extend `router.ts` and the owning route registries, shells,
`LayerView.tsx`, command palette links and route tests together.

| Section / utility    | Canonical address or existing address family                     | Access                                            |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| Play / Table         | `/table`                                                         | GM and player                                     |
| Prep: Scenes         | `/scenes`, `/scenes/list`, `/scenes/new`, `/scenes/:id?step=...` | GM                                                |
| Prep: Party          | `/roster`; `/characters/:id`, `/builder` remain existing layers  | Existing actor authorization                      |
| Prep: Maps           | `/scenes/maps`, `/scenes/maps/new`, `/scenes/maps/:id?step=...`  | GM                                                |
| Prep: Tokens         | New `/prep/tokens`, hosting existing `tokens/TokenLibrary.tsx`   | GM                                                |
| Prep: Sound          | `/viewer-controls/sound`, hosting existing sound board           | GM                                                |
| Prep: Replays        | `/replays`, `/replays/:id`                                       | Preserve existing player access to shared replays |
| Codex                | `/codex` and existing Codex addresses                            | Existing per-route/per-data gates                 |
| Compendium           | `/compendium` and existing record paths                          | GM; preserve player's Codex Compendium            |
| Table screen utility | `/viewer-controls`                                               | GM                                                |
| Shared TV entry      | `/viewer`                                                        | Existing paired viewer; not an SPA tab            |
| Settings             | `/settings` and existing children                                | Device shared, other sections GM                  |
| Player Sheet         | `/me`, plus existing authorized character/builder layers         | Player                                            |
| Player Log           | `/table?panel=log`                                               | Player; same log panel on laptop and phone        |

The new top-bar search is client work. The current `codex/CommandPalette.tsx` belongs to the Codex and
`compendium/SearchDialog.tsx` belongs to Compendium. Preserve those scoped searches and their authorization. Elsewhere,
the shell search opens a small launcher with Search the Codex, Search the Compendium (GM only), Rules and section
navigation. Choosing a search navigates to its section with a one-shot `openSearch=1` query, opens that section's
existing dialog and clears only that query key via `replaceQuery`. Rules uses the existing `reference/RulesReference`
dialog; keep Rules reachable from the scoped searches and Compendium too. Use one Ctrl/Meta+K handler for the active scope, avoiding competing shell and section listeners. Do not
invent a unified search API or expose the GM's Compendium to players. Presence labels use actual projected status;
when only character presence is available, say characters online rather than asserting a distinct-player count.
The table-screen lamp reflects the actual presentation state, not an assumed paired/online count.

The top GM tabs show Play, Prep, Codex and Compendium. All Prep addresses light Prep, with the relevant subtab, even
though they retain their existing heads. Sound lights Prep/Sound while `/viewer-controls` lights no main section.
A GM sheet/builder belongs to Prep/Party. Settings and screen controls remain utilities. An optional `/prep` entry
redirects to `/scenes` without replacing the existing scene overview or list.

Do not retire working addresses merely for grouping. Preserve all current redirects including `/scenes?view=maps`,
`/scenes/maps?map=<id>&from=table`, `/encounter`, `/setup`, `/homebrew` and Codex legacy routes. Preserve query strings,
`step`, `back`, dirty-navigation guards, Back/Forward, reload and remembered locations. Validate the one new token
address and `panel=log`; do not create a blanket player-accessible `/prep/*` namespace.

Phone bottom tabs remain visible at safe-area insets and use `100dvh` where appropriate. Keep sheet/builder dismissal,
pre-claim, multiple claims and no-character states. The player's Log and Table cannot mount duplicate roll subscriptions
or wipe a typed formula when switching tabs. Derive reconnecting state from `shell/useSession.ts`; account for both
`reconnecting` and `offline`, and wait for a refreshed snapshot before enabling stale game controls. No offline queue
is promised. The viewer continues its separate EventSource reconnect/pairing path.

## Phase 4: table and fight

Source anchors: `shell/TableView.tsx`, `table/{TablePanel,TableHeader,NeedsYou,PromptSlot}.tsx`,
`encounter/{TurnOrder,InitiativeList,GmEncounterPanel,PlayerEncounterPanel,ReactionPrompt,CombatLog,FightMenu}.tsx`,
`scene/{MapRail,EncounterMap,MapToken,GridLines}.tsx`, `sheet/TurnCard.tsx`, `sheet/turn-options.ts`,
`dice/DicePanel.tsx`, `lib/command.ts`, and `packages/domain/src/{commands,socket,views}.ts` (read only).

Preserve the current command helper, `commandId`, acknowledgements and revision guards. API command names are dotted
(`encounter.start`); Socket.IO event names are colon-separated (`encounter:start`). They are not interchangeable.

- Start uses `EncounterStartSchema`: `mapAssetId`, selected `entries` (`actorId`, optional `surprised`),
  `playersRollInitiative`, `groupMonsters`, and `expectedRevision`. Keep battle-map validation, no-empty-combatant
  handling, pending player initiative, group initiative and tie resolution. Staged tokens can still be off-map;
  preserve adding/removing/placing them and quick start when no scene is live. Counts are computed, never fixture text.
- Reuse `PlayerTurnEconomy` and `useMovementBudget`; the budget read includes Dash and other modifiers. Six squares
  mean 30 ft in the sample, not a fixed rule. A capped gauge retains the real numeric remainder, overflow and partial
  increments. Action/Bonus/Reaction lights reflect spent resources, extra actions and availability; never always READY.
- GM sees the real order; player and viewer see only projected entries. Hidden turn uses the existing GM turn state.
  NEXT means next visible entry for a restricted audience. At round boundaries use the actual cyclic order. Keep
  empty/single-entry/pending-initiative states; do not insert dummy hidden tiles or fetch missing actor data.
- Keep target picking, range/LOS, cover, spell areas, save targets, confirmations, typed dice, manual/automatic mode,
  Heroic Inspiration, Concentration, death saves and commanded creatures connected to their current flows.
- The Shield sample is not a replacement for all reactions. `attackRoll` is optional in the player's reaction.
  Pending cards also represent saves, rules asks, damage proposals and turn steps. Preserve each existing handler.
  `reaction:answer` with `use: false` declines normally. `reaction:dismiss` usually drops parked damage/attack/spell;
  offer it only with its accurate manual-resolution label. Never treat it as apply damage and continue.
- Formula composer: `dice:roll` requires `formula`, `purpose` and `visibility`; default quick rolls use `purpose:
"manual"` and the existing selected visibility, initially public. Keep public/GM-only/self-only/blind controls and
  feedback. Reuse `DicePanel` logic and the existing dice grammar; do not evaluate formulas or generate dice locally.
  Pressing a quick die sends one `1dN` roll; it does not clear the typed formula. Enter/Send submits the typed formula.
  Invalid formulas show the server reason and retain the text. Acknowledged typed rolls may clear the field. Before
  chat exists, all nonformula text is rejected as a formula; it is never silently sent as chat.
- The log currently has both projected rolls and a separately paged CombatLog feed. Preserve visibility, filters,
  deduplication by roll ID, reconnect/load-more behavior and sheet-local roll tracking. Do not duplicate entries when
  combining the composer and log. Do not replace persisted history with the current GameState roll window.

Preserve features omitted from the drawings in the following destinations, using existing components and menus:

| Existing feature                                                                                              | Destination in the redesign                                                        |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Rules policy, environment, roll-in/wait initiative, hit proposals, award XP, add/remove combatants, end fight | Fight options menu; preserve `FightMenu` and current dialogs                       |
| Previous/next turn, time travel and branch confirmation                                                       | Fight menu / history subpanel; retain revision safeguards                          |
| Needs you and player prompts                                                                                  | Fight pending region / player Table prompt region, reachable from any tab by badge |
| Dice options and GM roll calls                                                                                | Log options and Call for a roll; keep the full DicePanel tools reachable           |
| Token inspector, terrain, view/locate and player drawing                                                      | Map tool groups / overflow; do not delete because absent from the short drawn rail |
| Party rest, requests and resources                                                                            | Party tab / rest menu, preserving short/long-rest steps                            |
| Tonight board and embedded Codex notes                                                                        | GM Notes tab, with Tonight and Codex subviews using current components             |
| Viewer preview, fog/vision controls, scene switching                                                          | Table-screen utility / map tools / live scene picker                               |
| Shared replays and authorized player character tools                                                          | Existing entry points, reachable from their owning section                         |

## Phase 5: sheet and builder

Start at `sheet/CharacterSheet.tsx`, `sheet-main.tsx`, `sheet/TurnCard.tsx`, `sheet/Conversions.tsx`, `builder/CharacterBuilder.tsx`, `builder/draft.ts`,
and `builder/LevelFlow.tsx`. Preserve standalone `sheet.html` entry behavior as well as shell layers.

The phone sheet uses its drawn compact UI-font name and separate rest buttons; the laptop uses the full Bungee
header and Rest menu. Compact header details preserve the omitted vitals and HP editing in a sheet opened from an
accessible control on that header. Recompose existing roll and edit components. Rest, prepare, conversions and builder
rolls remain server-owned:
`actor:rest`, `rest:*`, `character:set-prepared`, `character:finish-preparing`, `actor:convert` for Arcane Recovery,
`builder:roll-abilities` and `character:save-draft`. Arcane Recovery availability comes from the existing offers and
rest step; it is not a permanently ready button. Keep resource spend/rest restrictions and disabled reasons.

Keep all ability methods allowed by the current builder policy (including custom methods), multiclass progression,
choices/ledger, level-up, equipment, inventory/currency, draft resume/discard, imports, validation and server roll
provenance. The illustrated wizard level, background modifiers, saved-draft caption and fixed steps are sample state.
Show a saved caption only after the draft acknowledgement. Reuse current preview calculations; no SRD or API rewrite
belongs in this phase. Missing WIP content is an explicit loading/unavailable state, never fixture replacement data.

## Phase 6: Prep, Codex, Compendium and joining

Prep sources: `scenes/{ScenesShell,ScenesOverview,SceneDocument,SceneEditor,ScenePreview,ScenePrepPanel,sceneFacts}`,
`encounter/EncounterBudget.tsx`, `scenes/StagingTray.tsx`, `scene/EncounterMap.tsx`.

Scene readiness is a presentation derivation, not a new persisted field: Live takes precedence; `mapAssetId === null`
means Needs a map. While the catalog loads, say Loading map. A referenced asset missing after load says Map unavailable
with repair navigation and must not say Ready. With a resolved map and known grid, `needsOf(facts).length === 0` means
Ready; otherwise Draft. `needsOf` already covers grid, nobody, off-map tray, vision without walls, and archived actors.
Preserve parked-fight and replay labels independently. An exploration scene's warnings are advisory; do not add a new
server-side or client-side Make live prohibition beyond existing validation. Keep confirmation when switching live fights.

Checklist rows come from those facts: map/grid, staged/placed actors, vision/walls, archived warnings and existing
sound preset information. Lights, music and walls are optional when their feature is unused; never require all five
illustrated checks or hard-code 5 of 5. Calculate XP from actual staged actors and current catalogs, using
`encounterBudget` / `encounterDifficulty` in `@vtt/rules-5e`. Reuse the current EncounterBudget data path; unknown
levels/CR/XP must not produce a false accurate meter. The sample 4,000 XP for three level 7 PCs is Moderate against
2,250 / 3,900 / 5,100 thresholds. Handle no party, mixed levels, zero foes and Beyond High. No rule changes in this phase.
Leave Fight settings out until phase 8; the sample Start with surprise switch is not a new saved scene field.

Codex sources: `codex/page/{GmPage,PlayerPage,MetaPanel,SeeAs,RevealTimeline}.tsx`, `codex/routes.ts`,
`codex/shell/sections.tsx`. Keep real server-backed audience reads, drafts/autosave conflict handling, versions,
block order, reveal history and restore confirmations. The five drawn top links do not remove Timeline, Sessions,
Relationships, Templates, tags, Backup or Codex Settings: keep secondary navigation / existing overflow. Field audiences
stay separate from page/block audiences. Player reads must never be derived by hiding parts of the GM document.

Compendium sources: `compendium/{CompendiumShell,TablesView,CompendiumTable,CompendiumCard}.tsx`,
`compendium/record/{RecordView,CardTab,SharingTab,HistoryTab,Studio}.tsx`, `encounter/MonsterBrowser.tsx`.
Keep all record kinds, SRD read-only rules, Make a homebrew copy, publish/update, pack/source management, audience gates,
import/export, history and conflict flows. Browse/Homebrew/Sharing are navigation labels over those existing behaviors.
Monster records are GM stat blocks; the pictured Share opens existing sharing rules and does not promise player stat blocks.

Add to a scene is new client orchestration. For a monster definition available to the existing monster catalog, open
a picker of non-live prepared scenes whose `scene.combat.active` is false, add via `actor:add-from-definition` with
existing staging visibility defaults and `joinEncounter: false`, then stage the returned actor ID through the scene operation
(`scene:set-combatants` with `sceneId` and the merged `combatantIds`). That command rejects the live scene and rebuilds
the prepared combat snapshot, so do not use it on a parked running fight. Live/parked fights direct the GM to their
existing fight-add flow instead. If no prepared scene is eligible, offer navigation to create one. Merge IDs from a
fresh snapshot after actor creation and use `expectedRevision` so concurrent staging cannot silently overwrite it.
Reuse the scene-prep staging path and keep existing actor IDs and positions.
Do not auto-activate the scene, join a different live fight, publish a draft or silently place the token. On create
success / stage failure, retain the returned actor ID and offer retry of staging that actor; never create a duplicate.
Nonmonster records and definitions not resolvable by the existing import/catalog path do not offer Add to a scene.
Preserve expected-revision handling and loading/error feedback; this is not assumed to be an atomic server operation.

Joining sources: `shell/Landing.tsx`, `actors/ClaimCharacter.tsx`, `lib/session.ts`, `shell/useSession.ts`.
Keep first-host setup restricted to loopback, GM password sign-in, returning sessions, claim conflicts, claimed/taken
characters, builder-policy entry points and disconnect/revocation feedback. The join art is decoration around those
existing flows. A character picker requires a player session; it is not a public pre-auth roster read.

## Phase 7: viewer and remaining surfaces

Sources: `viewer/{ViewerApp,ViewerPreviewPanel,ScreenPairing,TableSound}.tsx`, `viewer-main.tsx`,
`apps/server/src/{viewer-presentation,viewer-encounter,viewer-coordinator}.ts` (read only).
The viewer uses a paired cookie and EventSource presentation feed, not a player Socket.IO session. Its feed has no
rolls, class definitions or exact HP. Reserve the latest-roll area with the unavailable message until phase 8.
For an active entry without a matching placed token, use its projected name/ID fallback; do not fetch a GM actor.
When `hiddenTurn` is true, show GM turn; when initiative is not visible, show STOP and a noncombat state.
Honor enabled/paused, no-map, expired pairing, presentation map overrides, fog/vision and sound/autoplay restrictions.

Fit the entire map by default. Keep optional device zoom/pan/fullscreen utilities accessible on interaction and retain
GM camera-follow when explicitly selected; they are not gameplay controls. Reuse one presentation renderer for the
paired TV and GM preview so the two cannot diverge on layout. At 1920x1080 use the drawn 540px card column; at other
sizes reflow on aspect ratio and available space. Do not force a 540px column onto a small or portrait viewport.

Restyle remaining Settings, Codex home, Atlas, Story, all other Codex sections, maps, token/sound/replay libraries,
imports, rule reference, search, dialogs and editors with the same tokens and primitives. Preserve their behavior and
routes. No undrawn feature is removed because it was not in a sample screenshot.

## Phase 8: separate approved backend features

Each starts with its own next-available ADR and user sign-off before code. Preparing the ADR is authorized; backend
implementation waits for that feature's sign-off. Implement one feature at a time, independent of the others.

1. Table chat: confirm attribution to session/character, message length and rendering, visibility, deletion semantics,
   ordering, pagination/reconnect, rate limits, idempotency and retention. Confirm the proposed public GM+player audience,
   no whispers, 500-character cap and own-message/GM deletion. Extend the appropriate store and log model, migrate only
   the owning changed schema, and add projection/authorization tests. Render plain text safely; no HTML injection.
   Distinguish explicit roll intent (for example `/roll ...`) from malformed formulas so a bad roll is not broadcast
   as chat. Then enable the drawn combined composer and live chat lines.
2. Scene initiative defaults: persist only `playersRollInitiative` and `groupMonsters`, GM-only. Define omission/explicit
   override precedence in `encounter:start`, existing-scene defaults, duplicate/activate/park/replay lifecycle, and owning
   migrations. Surprise stays in per-entry encounter-start choices. Add the Prep settings UI after this lands.
3. Viewer public latest roll: extend the existing paired presentation/events feed with a sanitized derived card.
   Define what public means for hidden actors, targets, saves, annotations, private/blind rolls and roll kinds. Clear
   or replace stale cards on relevant map/scene/presentation changes. Keep GM preview in parity and paired-session
   revocation intact. No GM credentials or player session on the TV. A derived field alone need not require a DB migration.

For new game commands, use the actual shared path: domain schema and typed socket event, `GAME_COMMANDS` entry in
`packages/api-contract`, and `defineCommand` handler under `apps/server/src/commands`. Socket and HTTP transports
register from that table. New noncommand reads use `defineRoute` in the route registry. Assign integration scopes and
regenerate OpenAPI through that registry; do not hand-edit generated output or create parallel transport handlers.
Read the owning architecture section and projection rules, run `npm run map` after contract changes, and test both
transports, projection masking, storage upgrades and existing clients as relevant.

## Verification and phase completion

During edits run focused tests. At each phase boundary run `npm run format:check`, `npm run lint`, `npm run check`,
`npm test`; UI phases also `npm run build` then `npm run smoke`. Do not claim unrelated baseline failures were fixed.
Build before browser checks; smoke reads `apps/client/dist`.

The current `.claude/skills/verify/screens.mjs` has only `--as gm|player`, fixed 390x844 and 1280x800 captures, no theme
flag, no TV pairing mode and no setup for the drawn combat scenarios. Add small explicit options/scenario fixtures as
needed, using isolated temporary data. Do not invoke nonexistent `--theme` or TV flags until implemented. Select each
theme before capture, wait for self-hosted fonts, and inspect the image, not just screenshot success. Update helpers
with renamed accessible controls in the same commit. Keep existing semantic role/name checks meaningful.

Use the relevant paired mockups for these fixture states: GM before combat, GM combat, player own turn, player reaction,
player log, sheet, builder, Prep, Codex, Compendium, join and paired TV. For each applicable phase inspect both themes
at 390x844 and 1280x800; viewer at 1920x1080 plus a smaller/aspect-ratio case. Check 320px overflow and intermediate
760/980 widths when the changed layout reflows. Test keyboard focus, >=44px hit areas, safe area, on-screen keyboard,
reduced motion/transparency, no backdrop support, long names, larger/smaller parties and empty/loading/error states.

Preserve meaningful existing journeys; add targeted checks for the new routes, formula composer, selection/prompt flow,
privacy-aware pictures and deferred placeholders. A visual phase is not complete when screenshots show only an empty
server. In the phase report, distinguish observed evidence from acceptance checks still waiting on implementation.

# ADR-0037: The arcade cabinet redesign

## Status

Design approved, 2026-10-22. Implementation and session validation pending. The visual decision is settled;
implementation acceptance follows phases 0 to 4 and a home-group session. This status does not reopen the design.

Audited 2026-10-23 against `claude/friendly-babbage-g7gcge` at
`e8e90a3038f55ad55d9f15f5022aa566f36931d9`. See `docs/design/IMPLEMENTATION.md` for the concrete contracts.

## Context and decision drivers

Players who know D&D and another VTT (Foundry, Roll20, D&D Beyond) struggled to learn OzyVTT. A review in October 2026
found two causes. Most screens used layouts that no other tool uses, and most screens showed every control at once
instead of ranking what the person needs at that moment. Examples from that review:

- The GM had eight top tabs plus panel tabs, and the table screen offered the Codex twice.
- The fight panel was called Fight on a laptop and Scene on a phone, and its heading, eyebrow and button all said fight.
- Five magenta marks sat in the fight panel at rest, though magenta means press this.
- "Table" named the play surface, a list view and the homebrew source.
- Initiative settings sat on the play panel, where the GM runs a fight, instead of where the GM sets one up.

The look had a second problem. Surfaces, lines and secondary text were all one violet range, so the neon accents had
nothing to stand out against, and the 80s identity was mostly colour.

Drivers: a newcomer who knows other VTTs recognises each screen; each screen ranks what matters there; the 80s identity
carries information; phases 0 to 7 preserve the server contracts, with explicit phase 8 dependencies.

## Considered options

1. Tune the current design: fewer controls on each screen, same layouts and palette. Cheapest, and it leaves the
   unfamiliar layouts and the single violet range in place.
2. Adopt another VTT's layout and look. Familiar, and it gives up OzyVTT's identity and copies another product.
3. Conventional layouts with an arcade-cabinet look in which each 80s element has one job.

## Decision

Option 3, written up in `docs/DESIGN.md`, with the static mockups in `docs/design/mockups/` as the reference for values:

- Navigation. GM sections Play, Prep, Codex and Compendium; Scenes, the roster, maps, tokens, sound and replays become
  pages in Prep; the table screen controls open from a status button; settings is a gear. Player sections Table, Sheet
  and Codex. Phone bottom tabs: the GM's four sections, and Table, Sheet, Codex and Log for players.
- The table. A tool rail, turn order across the top of the map, the map, and one sidebar with Fight, Log, Party and
  Notes. During a fight the Fight tab shows the acting creature and only that turn's choices; before one it is where
  the GM starts the fight. The table screen (the shared TV) gets its own layout for reading across a room.
- Themes. Two, Dusk and Dawn, replacing Night, Dusk, Dawn and Day. Dusk is the dark theme: tinted glass over a
  blue-hour sky. Dawn is the light theme: soft paper and plum-grey ink, never pure white. One meaning per hue (the
  table in DESIGN.md). Token names stay; values change.
- Type. Bungee for titles and the primary, Bai Jamjuree for the interface, VT323 for numbers, Mr Dafoe in the wordmark.
  Tomorrow is retired.
- The 80s elements and their jobs: the sun frame for now, the sunset on arrival screens only, the horizon line on top
  bars, chrome lettering for who is acting, cabinet lamps for the action economy and on states, segmented life bars,
  the VCR round counter, the arcade primary button, a neon map grid, a target reticle and a scanline overlay.
- Twenty general default avatars, picked by actor id, and twelve class avatars for characters built with an SRD class.
- Fight settings move from the table to the scene's setup in Prep, saved on the scene (phase 8). Until then they
  stay where a fight starts.
- The roll log gains table chat: one box that sends a message, or a roll when what is typed is a dice formula
  (phase 8 for messages; formulas work from phase 4).

## What changes beyond the look

The redesign changes layout and adds interface, and three features need the server. Phases 0 to 7 are client-only;
phase 8 is the only one that touches the server, and each of its features gets its own ADR before any code.

Layout and navigation (client only):

- GM sections become Play, Prep, Codex and Compendium. Prep gathers Scenes, Party (the roster), Maps, Tokens, Sound and
  Replays; the table screen controls open from the top bar's status button; the rules reference opens from search and
  the Compendium; settings is the gear. Old addresses redirect.
- Players get Table, Sheet and Codex on a laptop, and Table, Sheet, Codex and Log as phone tabs.
- The table is a tool rail, turn order across the top, the map, and one sidebar (Fight, Log, Party, Notes). The GM's
  phone gets its own fight layout, and both get a before-a-fight state.
- The table screen: a top band with the turn order, the map fitted on the left, and Acting now and the latest roll in
  a column on the right. The current TV feed supports the map and turn order, but carries no roll feed. The latest-roll
  card needs phase 8's viewer-roll feature; phase 7 leaves its reserved card with an honest unavailable state.
- The Codex loses its left rail; a page's metadata moves to a side panel.

New interface on data and commands that exist (client only):

- Lamps, life bars, the VCR counter, the NEXT tag, spell slot pips and the six-square Move gauge, all drawn from state
  the client already holds.
- Rest actions (`actor.rest` and the `rest.*` party flow): one menu on a laptop, separate buttons on the phone as
  drawn. Change prepared spells (`character.set-prepared`),
  Arcane Recovery (its existing command), Ping (`annotation.ping`), the builder's Roll 4d6 (`builder:roll-abilities`)
  and its saved draft (`character.save-draft`).
- Reaction actions use the existing semantics: `reaction.answer` with `use: false` declines and normally continues
  resolution; `reaction.dismiss` generally discards held results after manual resolution. The three-box Shield
  readout is conditional on values included in that viewer's projection. Other reaction kinds keep their own flow.
- The encounter difficulty meter, from `rules-5e`'s per-level budgets and the scene's staged monsters.
- Scene readiness in Prep uses `factsOf` and `needsOf` in `apps/client/src/scenes/sceneFacts.ts`: Live first; Needs a
  map when `scene.mapAssetId` is null; Ready after the map library has loaded, the referenced map is found, grid is
  known and `needsOf(facts)` is empty; otherwise Draft. Loading and missing assets are distinct states. Preserve
  Fight parked and Replay as secondary labels and their existing actions. IMPLEMENTATION.md defines the checklist.
- Quick dice and typed dice formulas in the log's message box (`dice:roll` takes a formula).
- Start a fight: who is in, the initiative switches and Surprised all go to `encounter:start` as they do today; the
  join address comes from the host's join URLs.
- Focus rings, toasts, the reconnecting bar, empty states and motion, as DESIGN.md defines them.
- Add to a scene is a new client workflow, reusing `actor:add-from-definition` followed by the selected scene's
  existing staging operation. It applies to resolvable monster records, not every Compendium kind or unpublished
  drafts. Do not assume the Compendium already has this button. IMPLEMENTATION.md defines targeting and failures.
- Default avatars and the Dusk and Dawn themes.

New functionality that needs the server (phase 8, each with its own ADR first):

1. Table chat. Today the log holds rolls and game events only. Chat needs a domain command and schema, a server handler,
   a log entry type, its place in each projection, storage changes and any required migration, a shared command-registry
   entry with an integration scope, generated OpenAPI updates, and tests including projection tests. Proposed defaults for that ADR: messages reach the
   GM and every player, not the table screen; no whispers in the first version; 500 characters at most; the GM can
   delete any message and a player their own.
2. Fight settings saved on a scene. Today "players roll their own initiative" and "one roll for each group of
   identical monsters" are choices held on screen and sent with `encounter:start`. Saving them needs scene fields,
   a command to set them, the scene projection carrying them, a migration, and `encounter:start` defaulting to them.
   "Start with surprise" stays a per-combatant choice when the fight starts, not a third saved boolean. Include
   duplicate, activate, parked-fight and replay behavior; store ownership and migration needs must follow the final ADR.
3. Viewer rolls. The TV presentation needs a sanitized latest public roll and enough public display metadata for that
   card, sent through its existing authenticated presentation/events feed. The feed currently has none. Its ADR must
   cover private and blind rolls, hidden sources/targets, clearing stale rolls on scene/presentation changes, and both
   the TV and GM preview. Never give the TV a player session or GM token. Reuse a safe existing roll projection where
   possible, and add projection and revocation tests. Do not presume a database migration is required for a derived card.

Until phase 8 lands, the message box takes dice formulas only and says so in its placeholder, and the fight settings
stay in the start-a-fight step. The TV latest-roll card stays unavailable until its phase 8 dependency lands.

## Consequences and tradeoffs

- Every surface changes look. Because token names stay, most components restyle without code changes.
- New primitives: Lamp, LifeBar, VcrCounter, Tag, Portrait (a picture with party, enemy, hidden and now frames) and
  Avatar, plus an arcade variant of Button and a reticle layer on the map.
- Retired: the chrome lip and rims (`--material-lip`, `--lip`, `--lip-h`, `--rim-*`), the heading shadow and Tomorrow.
- Navigation groups change. Keep the existing record URLs and mount them under the new section bars; this avoids
  unnecessary address migration. Prep sections use the route matrix in IMPLEMENTATION.md. `/viewer-controls` remains
  the top-bar utility and `/viewer` remains the server's separate TV entry. Add `/prep/tokens` and the player's
  `/table?panel=log`; no existing address is retired merely because its label or navigation group changes.
- The smoke journeys and `.claude/skills/verify/screens.mjs` find controls by role and name (GM sections, Enter as GM,
  Join as Player). They change in the same commits as the controls.
- Night and Day are retired. `THEMES` becomes `["dusk", "dawn"]`, Dusk's values move into `:root`, and the
  `dark` and `light` rules go. A device that stored `dark` gets `dusk` and one that stored `light` gets `dawn`, rewritten
  on first read, so nobody's choice flips between light and dark. With nothing stored, the app follows
  `prefers-color-scheme`. The no-flash script in each HTML entry repeats the ids and the default, so it changes with
  `theme.ts`. Theme switches offer two options.
- Dusk's glass uses bounded blur layers. Reduced transparency and lack of backdrop-filter support use solid surfaces.
  Theme checks cover solid colours, composited glass and essential edges; old four-theme assertions must be replaced.
- Static effects avoid animation loops but can still cost paint/compositing work. Do not copy the mockups' broad
  nested backdrop-filter selectors; check scrolling, map interaction and reduced settings on a phone.

## Mobile, security, and visibility impact

- Phone and laptop keep the same features, and touch targets stay at 44px or more.
- Phases 0 to 7 change no projection, command, HTTP route or stored data. Phase 8's three features do, and their own
  ADRs cover chat recipients, GM-only scene defaults and sanitized public viewer rolls.
- A class avatar shows only where the viewer's projection includes that character's classes, so the party visibility
  setting (What players see of each other) keeps working; otherwise the general pick applies.
- Default avatars are picked on the client from the actor id, which every viewer already receives. Picking by monster
  definition is not allowed: a shared picture would tell players that two hidden creatures are the same kind. Static is reserved
  for an explicit anonymous-identity state, which the current projection does not supply. Hidden actors remain absent.
- Hidden combatants stay absent from player and table screen views; a player's turn order lists only what that player's
  projection holds.

## Migration / reversibility

Nine numbered phases: phase 0 installs the handoff; phases 1 to 7 implement the client; phase 8 handles three backend
features, each with its own ADR and approval before code. Both themes ship in every UI phase. Each UI phase passes
format, lint, check, test, build and smoke. Restore the relevant commits to revert a phase; changing palette values
alone cannot undo fonts, primitives, layout and theme-storage migration. Phase 8 ADRs define their own reversibility.

## Required validation evidence (not yet collected)

- `packages/ui/src/theme/themes.test.ts` passes for both themes, and a stored `dark` or `light` migrates.
- `apps/client/src/writing.test.ts` passes.
- Screenshots from `.claude/skills/verify/screens.mjs` at 390px and 1280px match the mockups page by page, in Dusk
  and in Dawn, and the table screen matches its mockup at 1920 by 1080.
- `npm run smoke` passes with the updated journeys.
- One session played on it by the home group, and the GM's notes on what still took hunting for.

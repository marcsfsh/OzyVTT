# Polish handoff

The polish pass designs every surface in OzyVTT again, piece by piece, under the Light Rail / Horizon theme. This folder
belongs at `docs/design/polish/` in the repository. ESLint and Prettier skip it, so it stays as written.

Each piece has its own folder with a `PROMPT.md`, the message to paste into the session that builds it. Every handoff
zip carries the whole folder, so the catalog and earlier pieces stay current.

- `CATALOG.md` is the map: every surface, grouped by what it is and the job it does, top down from the theme (T) through
  the areas (A to I). It also says the order the areas get designed in and each one's status.
- `T-theme/` is the theme spec, the top of the hierarchy:
  - `SPEC.md` is the spec every area inherits: the five decisions, twenty rules and the page patterns. Rules 13 to 20
    came from the three consistency sweeps.
  - `PLAN.md` is the implementation plan, in phases T0 to T7.
  - `ADR-0048-theme-spec.md` goes to `docs/adr/0048-theme-spec.md` in phase T0.
  - `theme-spec.html` is the approved mockup; `mockup-src/` its source (`sh mockup-src/build.sh`); `history/` the four
    rounds.
  - `PROMPT.md` starts the session that builds it.
- `T-consistency/` is the three consistency sweeps across every approved area, and the shared parts they settled: one
  side list, the crumb on the title's line, a menu that names its thing, one way a phone sheet opens, one Cup in view,
  what a phone header names, a list's toolbar, fields, states and kinds, buttons and hit areas, rows and the controls in
  them, steps, overlays, type, colour, dates and copy, one eyebrow, one notice, title sizes and the last hit areas, and
  Dawn's coloured words, one tag, one close, one stepper, tabs, fields and lamps:
  - `SPEC.md` is what was decided: seven fixes, then eleven, then twenty, then sixteen, then twenty-five, made in each
    area's approved mockup and spec, and theme rules 13 to 21 with amendments to 2, 9, 12, 13 and 14, then to 2.2, 2.5
    and rules 2, 7, 8, 9, 10 and 11, then to 2.2, 2.4, 2.5 and rules 8, 9, 19 and 20, then to 2.2, 2.4, 2.5 and rules 4,
    9 and 19.
  - `PLAN.md` is the implementation plan, in phases O0 to O13: each shared part built once in the kit.
  - `ADR-0072-shared-parts.md`, `ADR-0073-shared-parts-second-sweep.md`, `ADR-0074-shared-parts-third-sweep.md`,
    `ADR-0075-shared-parts-fourth-sweep.md` and `ADR-0076-shared-parts-fifth-sweep.md` go to `docs/adr/` in phase O0.
  - `consistency.html` shows every shared part as the approved mockups now draw them; `mockup-src/` captures and builds
    it (`sh mockup-src/build.sh`, with Playwright and Pillow); `history/1-sweep.html` to `history/5-sweep.html` are the
    sweeps as shown, `history/3-before-after.html` sets each of the third sweep's fixes before and after, and
    `history/4-sweep.html` and `history/5-sweep.html` do the same for the fourth's and the fifth's. Every approved
    mockup's `mockup-src/p4t-touch.css` draws its phone controls at 44 px, and its `mockup-src/p4v-parts.css` the fifth
    sweep's shared values.
  - `PROMPT.md` starts the session that builds it.
- `A-frame/` is area A, the frame around every page: the top bar, the phone's tabs and header, search and news:
  - `SPEC.md` is what was decided: four decisions and eleven rules for the frame.
  - `PLAN.md` is the implementation plan, in phases A0 to A7.
  - `ADR-0049-frame-and-wayfinding.md` goes to `docs/adr/0049-frame-and-wayfinding.md` in phase A0.
  - `frame.html` is the approved mockup; `mockup-src/` its source (`sh mockup-src/build.sh`); `history/` round 1.
  - `PROMPT.md` starts the session that builds it.
- `B-arrival/` is area B, arrival: the title screen, signing in, picking a character and inviting players:
  - `SPEC.md` is what was decided: four decisions and eleven rules.
  - `PLAN.md` is the implementation plan, in phases B0 to B6.
  - `ADR-0052-arrival.md` goes to `docs/adr/0052-arrival.md` in phase B0.
  - `arrival.html` is the approved mockup (on a phone it has its own bar and a Close up laptop view); `mockup-src/` its
    source (`sh mockup-src/build.sh`); `history/` rounds 1 and 2.
  - `PROMPT.md` starts the session that builds it.
- `C-table/` is area C's frame, the table: the workbench, the turn order, the turn and the phone table:
  - `SPEC.md` is what was decided: four decisions and eight rules. The groups inside the table come in later rounds.
  - `PLAN.md` is the implementation plan, in phases C0 to C7.
  - `ADR-0050-table-frame.md` goes to `docs/adr/0050-table-frame.md` in phase C0.
  - `table.html` is the approved mockup (the phone's Map, Turn, Log and Party work); `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` round 1.
  - `PROMPT.md` starts the session that builds it.
- `C3-gm-panel/` is C3's first round, inside the table's frame: the GM panel's tabs, what waits on the GM and the bell:
  - `SPEC.md` is what was decided: four decisions and nine rules. C3's second round comes later.
  - `PLAN.md` is the implementation plan, in phases Q0 to Q5.
  - `ADR-0058-gm-panel-and-attention.md` goes to `docs/adr/0058-gm-panel-and-attention.md` in phase Q0.
  - `gm-panel.html` is the approved mockup (the tabs, their counts and the list's switch work inside its frames);
    `mockup-src/` its source (`sh mockup-src/build.sh`); `history/` round 1.
  - `PROMPT.md` starts the session that builds it.
- `C3-running/` is C3's second round: starting an encounter, a creature's tools, the encounter's options, adding
  monsters and the rolls in waiting cards:
  - `SPEC.md` is what was decided: five decisions and seven rules, each built from settled parts.
  - `PLAN.md` is the implementation plan, in phases R0 to R6.
  - `ADR-0059-running-the-encounter.md` goes to `docs/adr/0059-running-the-encounter.md` in phase R0.
  - `running.html` is the approved mockup, with its Carried in list; `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` the round.
  - `PROMPT.md` starts the session that builds it.
- `C5-log-dice/` is C5, log and dice: the log, the composer, the dice options and calls for a roll:
  - `SPEC.md` is what was decided: five decisions and eight rules, each built from settled parts.
  - `PLAN.md` is the implementation plan, in phases L0 to L5.
  - `ADR-0060-log-and-dice.md` goes to `docs/adr/0060-log-and-dice.md` in phase L0.
  - `log-and-dice.html` is the approved mockup, with its Carried in list; `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` the round.
  - `PROMPT.md` starts the session that builds it.
- `C2-map-menus/` is C2, the map's menus: a token's menu, how it moves, a door, a tool's options and a drawing:
  - `SPEC.md` is what was decided: six decisions and six rules, each built from settled parts.
  - `PLAN.md` is the implementation plan, in phases M0 to M6.
  - `ADR-0062-map-menus.md` goes to `docs/adr/0062-map-menus.md` in phase M0.
  - `map-menus.html` is the approved mockup, with its Carried in list; `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` the round.
  - `PROMPT.md` starts the session that builds it.
- `C4-C6-player/` is C4 and C6, a player in a fight: the prompts, a reaction, dying, what a cast asks and the spell
  card:
  - `SPEC.md` is what was decided: six decisions and eight rules, each built from settled parts.
  - `PLAN.md` is the implementation plan, in phases P0 to P6.
  - `ADR-0061-a-player-in-a-fight.md` goes to `docs/adr/0061-a-player-in-a-fight.md` in phase P0.
  - `a-player-in-a-fight.html` is the approved mockup, with its Carried in list; `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` the round.
  - `PROMPT.md` starts the session that builds it.
- `E2-maps-tokens/` is E2 with E3.1 and C6.8, maps and tokens: the Maps page, a map's page, folders, the Tokens page and
  the token picker:
  - `SPEC.md` is what was decided: five decisions and eight rules, each built from settled parts.
  - `PLAN.md` is the implementation plan, in phases K0 to K6. K4 is the pass's first server change (GM-only token
    groups), approved by the owner.
  - `ADR-0063-maps-and-tokens.md` goes to `docs/adr/0063-maps-and-tokens.md` in phase K0.
  - `maps-and-tokens.html` is the approved mockup, with its Carried in list; `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` the round.
  - `PROMPT.md` starts the session that builds it.
- `F-finding-pages/` is F's second round, finding and pages: search, the pages index, a tag, revealing, version history,
  the palette and the page picker:
  - `SPEC.md` is what was decided: five decisions and seven rules, each built from settled parts.
  - `PLAN.md` is the implementation plan, in phases N0 to N6.
  - `ADR-0064-finding-and-pages.md` goes to `docs/adr/0064-finding-and-pages.md` in phase N0.
  - `finding-and-pages.html` is the approved mockup, with its Carried in list; `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` the round.
  - `PROMPT.md` starts the session that builds it.
- `E3-sound-screen/` is E3.2 with what H left for later, sound and the screen: the sound board, what is playing, putting
  a sound on, an encounter's sound, See as the table screen and Settings' table screen row:
  - `SPEC.md` is what was decided: five decisions and seven rules, each built from settled parts.
  - `PLAN.md` is the implementation plan, in phases W0 to W6. W3 is a server change (the `sound.seek` command for the
    scrubber), approved by the owner.
  - `ADR-0065-sound-and-the-screen.md` goes to `docs/adr/0065-sound-and-the-screen.md` in phase W0.
  - `sound-and-the-screen.html` is the approved mockup, with its Carried in list; `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` the round.
  - `PROMPT.md` starts the session that builds it.
- `E3-replays/` is E3.3 to E3.5 with C4.6, replays: the list, watching one, the GM's actions and a player's shared
  replays:
  - `SPEC.md` is what was decided: five decisions and six rules, each built from settled parts. The owner put two
    options together for the list and asked for the date to the right of a replay's name.
  - `PLAN.md` is the implementation plan, in phases Y0 to Y6.
  - `ADR-0069-replays.md` goes to `docs/adr/0069-replays.md` in phase Y0.
  - `replays.html` is the approved mockup, with its Carried in list; `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` the round.
  - `PROMPT.md` starts the session that builds it.
- `F-story-people/` is F's third round, the story and people: quests, relationships, a faction's standing, adding to the
  chronicle, and where downtime sits:
  - `SPEC.md` is what was decided: five decisions and seven rules, each built from settled parts.
  - `PLAN.md` is the implementation plan, in phases S0 to S6. S5 builds the Downtime tab from `F3-atlas/SPEC.md` 2.5.
  - `ADR-0066-story-and-people.md` goes to `docs/adr/0066-story-and-people.md` in phase S0.
  - `story-and-people.html` is the approved mockup, with its Carried in list; `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` the round.
  - `PROMPT.md` starts the session that builds it.
- `F3-atlas/` is F3, the Atlas, with the story's Downtime tab: the maps as a tree, the pins at the right, a pin's page
  and menu, the pin editor in tabs, adding a map, and the Downtime tab's contents:
  - `SPEC.md` is what was decided: five decisions and seven rules, each built from settled parts. The owner put two
    options together for the Atlas, then asked that a pin's page also carry the party's position and who sees it.
  - `PLAN.md` is the implementation plan, in phases V0 to V6. The Downtime tab is built by `F-story-people/PLAN.md` S5.
  - `ADR-0067-atlas.md` goes to `docs/adr/0067-atlas.md` in phase V0.
  - `the-atlas.html` is the approved mockup, with its Carried in list; `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` the round.
  - `PROMPT.md` starts the session that builds it.
- `F-time-tools/` is F's fifth round, time and tools: prep templates, the calendar, a timeline record, and the Codex's
  backup and saving tools:
  - `SPEC.md` is what was decided: six decisions and eight rules, each built from settled parts. The owner put options
    together for a session from a template and for the tools, and asked that every side list match the settled one.
  - `PLAN.md` is the implementation plan, in phases Z0 to Z7.
  - `ADR-0070-time-and-tools.md` goes to `docs/adr/0070-time-and-tools.md` in phase Z0.
  - `time-and-tools.html` is the approved mockup, with its Carried in list; `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` the round, with the replays check.
  - `PROMPT.md` starts the session that builds it.
- `G-compendium-pages/` is G's second round, the Compendium's pages: Sources, Sharing, a record's history, merging and a
  record's sharing:
  - `SPEC.md` is what was decided: five decisions and eight rules, each built from settled parts. Its rules also settle
    search's dialog, the catalog picker and the other kinds' editors.
  - `PLAN.md` is the implementation plan, in phases X0 to X6.
  - `ADR-0068-compendium-pages.md` goes to `docs/adr/0068-compendium-pages.md` in phase X0.
  - `compendium-pages.html` is the approved mockup, with its Carried in list; `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` the round, with the Atlas check.
  - `PROMPT.md` starts the session that builds it.
- `I-settings-leftovers/` is I's second round, Settings' leftovers: the API reference, an operation, the commands, At
  the table's actions, a credential's page, and Settings' side list matched to the settled one:
  - `SPEC.md` is what was decided: six decisions and seven rules, each built from settled parts. It amends I's side list
    (2.1) and F's time and tools' Codex group.
  - `PLAN.md` is the implementation plan, in phases U0 to U6.
  - `ADR-0071-settings-leftovers.md` goes to `docs/adr/0071-settings-leftovers.md` in phase U0.
  - `settings-leftovers.html` is the approved mockup, with its Carried in list; `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` the round, with the time and tools check.
  - `PROMPT.md` starts the session that builds it.
- `D-characters/` is the rest of area D: the roster, making a character, levelling up and a party member:
  - `SPEC.md` is what was decided: four decisions and ten rules.
  - `PLAN.md` is the implementation plan, in phases D0 to D6.
  - `ADR-0051-characters.md` goes to `docs/adr/0051-characters.md` in phase D0.
  - `characters.html` is the approved mockup; `mockup-src/` its source (`sh mockup-src/build.sh`); `history/` round 1.
  - `PROMPT.md` starts the session that builds it.
- `E-prep/` is area E's frame, prep: the shelf of encounters, an encounter's page, a new encounter and a map's grid:
  - `SPEC.md` is what was decided: four decisions and nine rules. Prep's other pages come in later rounds.
  - `PLAN.md` is the implementation plan, in phases E0 to E5.
  - `ADR-0053-prep-frame.md` goes to `docs/adr/0053-prep-frame.md` in phase E0.
  - `prep.html` is the approved mockup; `mockup-src/` its source (`sh mockup-src/build.sh`); `history/` round 1.
  - `PROMPT.md` starts the session that builds it.
- `F-codex/` is area F's frame, the Codex: its bar, home, reading and writing a page, and the story's tabs:
  - `SPEC.md` is what was decided: four decisions and ten rules. The Codex's other pages come in later rounds.
  - `PLAN.md` is the implementation plan, in phases F0 to F6.
  - `ADR-0054-codex-frame.md` goes to `docs/adr/0054-codex-frame.md` in phase F0.
  - `codex.html` is the approved mockup (Preview and the story's tabs work inside its frames); `mockup-src/` its source
    (`sh mockup-src/build.sh`); `history/` round 1.
  - `PROMPT.md` starts the session that builds it.
- `G-compendium/` is area G's frame, the Compendium: its bar, home, browsing, a record and making homebrew:
  - `SPEC.md` is what was decided: four decisions (browsing and records chosen together as three panes) and eleven
    rules. The Compendium's other pages come in later rounds.
  - `PLAN.md` is the implementation plan, in phases G0 to G6.
  - `ADR-0055-compendium-frame.md` goes to `docs/adr/0055-compendium-frame.md` in phase G0.
  - `compendium.html` is the approved mockup (the open records' tabs, a record's parts and Edit work inside its frames);
    `mockup-src/` its source (`sh mockup-src/build.sh`); `history/` rounds 1 to 3.
  - `PROMPT.md` starts the session that builds it.
- `H-table-screen/` is area H, the table screen: the TV's live screen, pairing and waiting, the GM's controls and the
  preview:
  - `SPEC.md` is what was decided: four decisions and eleven rules.
  - `PLAN.md` is the implementation plan, in phases H0 to H6.
  - `ADR-0056-table-screen.md` goes to `docs/adr/0056-table-screen.md` in phase H0.
  - `table-screen.html` is the approved mockup (a screen's card opens its remote inside the GM's frames); `mockup-src/`
    its source (`sh mockup-src/build.sh`); `history/` rounds 1 and 2.
  - `PROMPT.md` starts the session that builds it.
- `I-settings/` is area I, Settings: its frame and search, Players, Encounters, Characters, Device and Access:
  - `SPEC.md` is what was decided: four decisions and nine rules. The API reference comes in a later round.
  - `PLAN.md` is the implementation plan, in phases I0 to I5.
  - `ADR-0057-settings.md` goes to `docs/adr/0057-settings.md` in phase I0.
  - `settings.html` is the approved mockup; `mockup-src/` its source (`sh mockup-src/build.sh`); `history/` round 1.
  - `PROMPT.md` starts the session that builds it.
- `D1-character-sheet/` is the first piece, the character sheet, chosen as the Ledger:
  - `PLAN.md` is the implementation plan. Start there. Sections 1 to 4 are the decision, the rules, what is on the
    branch now and the design; section 5 is the work in eight phases, L0 to L7.
  - `ADR-0047-ledger-character-sheet.md` goes to `docs/adr/0047-ledger-character-sheet.md` in phase L0.
  - `ledger-sheet.html` is the approved mockup at laptop, phone and Table panel sizes, in Dusk and Dawn. Open it in a
    browser; fonts load from Google Fonts and everything else is inline.
  - `mockup-src/` is its source in parts. `sh mockup-src/build.sh` rebuilds the page.
  - `history/` holds the four rounds of mockups that led to the Ledger. Context only; the choice is made.
  - `PROMPT.md` starts the session that builds it.

The plans were read against `marcsfsh/OzyVTT` at `f5e166f` on `claude/friendly-babbage-g7gcge`. Another session commits
design work on that branch, so section 2 of each plan says how to share it. Build them in the order T, then A, then C,
with D1 alongside, D after D1, B after C1, E after C3, F after A, G after A, H after A, I after A, C3's first round
after C5, its second after its first, C5 (log and dice) after C3's first round, C4 with C6 (a player in a fight) after
C3's second round, C2 (the map's menus) after C4 and C6, E2 (maps and tokens) after E, F's finding and pages after F, E3
(sound and the screen) after E and H, F's story and people after F's finding and pages, F3 (the Atlas) after F's story
and people, G's pages after G and F's finding and pages, E3's replays after E3's sound, F's time and tools after F's
story and people, G's pages and I, I's leftovers after F's time and tools, and the shared parts (T-consistency) after T
and A's dialogs and menus, before or alongside the areas; each plan says what it waits for.

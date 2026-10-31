# B Arrival: building it

Written on 2026-10-29 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update U6: ADR-0046 and the handoff"). This plan rebuilds the title screen, the GM's sign-in and first run, picking a character and the GM's empty table. It adds no rules, commands or data. File paths and line numbers were read at `f5e166f`; the theme (T), the frame (A), the table (C) and characters (D) land on the same branch first or alongside, so confirm every anchor before editing. Paths are under `apps/client/src/` unless they start with `packages/`, `apps/server/`, `e2e/` or `docs/`.

This is area B in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, B0 to B6, each about one commit.
- The reference is `arrival.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything else is inline). It opens on the approved choices. Use the Page switch (Title screen, GM sign-in, First run, Pick a character, Invite players). The other options in the four decision switches are the ones the owner turned down; build only the chosen ones. On a phone the page has its own bar and a Close up, Whole and Turned laptop view. `history/` holds both rounds as they were shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its scene is a copy of `shell/landing.css` and its character art is a stand-in for `ActorPortrait`. Build with the existing components, hooks and primitives. Section 8 lists where the plan departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md` applies on top, and `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. The title screen is Sky: today's scene with a smaller sun, the logo in clear sky above it, and the two buttons on the grid below the horizon.
2. Signing in and first run are In place: a card takes the buttons' place below the horizon while the scene eases up.
3. Picking a character is Lineup: the party stands before the sunset as tall cards; with a map live the same cards sit in the table's panel.
4. Inviting players is the Lobby: while no map is live, the GM's empty table shows the join code and address and the party filling in.
5. Eleven rules for arrival (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it.
- B builds on T, A and C. T1 to T3 (the Base line, `Group`, empty states) and A1 to A3 (the menu, the phone frame without a top bar) must be on the branch before B1. C1 (the workbench and the strip's pieces moving into the Encounter tab) must be on the branch before B4 and B5. If one is missing, stop at the phase that needs it and tell the user.
- D (characters) changes the roster and says who plays each character with a lamp (D rule 4). If D1 has added a helper for those words, the lobby uses it; if not, B5 adds it to `actors/actor-display.ts` and D uses it.
- CLAUDE.md applies in full. The server decides every claim; `character:claim` keeps going through the same code. Projections are the boundary: the pick page shows only the `PlayerActor` fields a player already receives for an open character, and the lobby reads only what `GmView` already holds (`ownerSessionId`, `presence`, `playedAtTable`). No server code, shared domain, schema, command or HTTP route changes. If a step seems to need one, stop and tell the user.
- `design-conventions.test.ts`: tokens (d), the breakpoint ladder (f), `.scroll-y` (h), the display face in capitals (i), one Eyebrow (c), toasts (e), and the vh allowlist for `landing.css` (293: `4vh`, `3.5vh`, `4.5vh`; update it if the layout's vh values change).
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area. The sunset belongs to arrival only (42, 336 to 338).
- Motion keeps its light (ADR-0045): the entry drive, the ignition, the twinkle, the grid roll and the claim light on the chosen character stay, and reduced motion freezes them as now.
- `play-vocabulary.test.ts` bans "unclaimed", "taken" and "fight" in copy and pins "Claim" and "Claim $?" in `ClaimCharacter.tsx` (117, 166).
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before calling a phase done, and look at the pages at 390 px and 1280 px in Dusk and Dawn (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 The title screen and signing in

- `shell/Landing.tsx` (250 lines): `useEntryAnimation` (14 to 48; the drive, settle at 1500 ms, clear at 1900 ms, reduced motion commits at once; wired at `App.tsx:78` and `useSession.ts:47`, 190 to 191, 207); `LandingScene` (56 to 70: stars, `landing-skyband` with `landing-sun`, mountains, horizon, grid, noise); `Landing` (72 to 232): `door` "choose" or "gm" (98 to 101), `phone` is `(max-width: 560px)` (107), the flare (121), the hero `h1.home-hero-title` with `<Wordmark variant="cabinet" className="home-hero-mark"/>` (122 to 126), `section.choices` with "Join as Player" and "Enter as GM" (128 to 145), the GM card `section.card.landing-gm` (147 to 223: "GM sign-in" or "Set up the GM password", the line, `form.landing-gm-form`, the field "GM password" with Show (161 to 179), the Keep me signed in Switch (181 to 188), `.landing-gm-actions` with Enter table or Set GM password and Back (189 to 204), `.landing-reset` with Forgot the password opening the Modal "Reset the GM password" (207 to 222)), `<Notice>` (226), the theme switch (227 to 229); `ResetSteps` (235 to 250).
- HTTP: `HOST_PATHS.setup` (GET `useSession.ts:92`, POST `setGmPassword` 257 to 269) and `HOST_PATHS.gmSignIn` (`signInGm` 244 to 255); the player door is the socket's `session:join` (`joinPlayer` 228 to 240).
- `shell/landing.css` (523 lines): `.landing` 7 to 19 (a centred flex column), the scene 37 to 67, `.landing-skyband` 70 to 75 (`inset: 0 0 36% 0`), `.landing-sun` 78 to 90 (`--sun-d: clamp(15rem, 36vw, 27rem)`, `bottom: calc(var(--sun-d) * -0.28)`), mountains 93 to 132 and horizon 133 to 141 (both `top: 64%`), grid 144 to 155, the drive 196 to 330, the wordmark 332 to 350 (`.nh-wordmark-ozy` `clamp(3.4rem, 15vw, 8.5rem)`, `.nh-wordmark-vtt` `clamp(4.4rem, 19vw, 11rem)`), `.choices` 354 to 374, the theme switch 376 to 382, the card 389 to 397, the form 399 to 437, motion 442 to 515, phone 519 to 523.
- Dead selectors: `.landing .home-hero-title .nh-wordmark` (336 to 340) and the ignition at 443 to 445 never match (the cabinet mark is `.nh-wordmark-cabinet`), and the same at `styles.css:373`.
- Tokens: `--landing-*` in `packages/ui/src/styles/design-tokens.css` (Dusk 241 to 285, Dawn 660 to 685). `packages/ui/src/primitives/Wordmark.tsx` (cabinet 17 to 27) and `Wordmark.css` (53 to 69).

### 3.2 Picking a character

- `actors/ClaimCharacter.tsx` (209 lines): `pickLine` (30 to 34, "Dwarf Fighter 7 · HP 74"); `ClaimCharacter({ state, art })` (42 to 209): the open and claimed sets and the chosen one (51 to 55, one open character chosen from the start), the claim light (57 to 75), `claim` (77 to 96: the confirm "Claim {name}?" with "You play X at this table until you release X." and Claim, then `command("character:claim", { actorId, expectedRevision })`, the toast "You're playing X." and `navigate("/me")`); the picker (98 to 197): `section.claim-view.scroll-y`, h2 "Pick your character", `p.claim-status` with `StatusLamp` ("Nobody has claimed a character yet." or "N of M characters are claimed."), the released Alert, the empty state "Nothing to claim yet", `ul.claim-list` as a radiogroup of `li.claim-row` (`.is-taken`, `.is-chosen`, `data-actor`) each with `button.claim-row-pick` (role radio), `ActorPortrait frame="party" size="md"`, the name, the line and, when claimed, "Claimed on another device. Ask the GM to release it." with a `Tag`; `.claim-actions` with Make a new character (when the builder is open) and Import from D&D Beyond (PDF); `Button.claim-play` ("Play as {first name}" or "Pick a character to play"); the art wrapper (199 to 208): `.claim-screen > .claim-art.landing-scene-host > LandingScene + Wordmark` and the picker.
- `actors/claim-character.css` (156 lines): rows 3 to 106, `.claim-screen` 109 to 114, `.claim-art` 115 to 118, `.claim-art-mark` 119 to 125, the panel 126 to 132, the phone band 133 to 148, `.claim-row-edge` 150 to 156. The art version has no rule for `landing-scene-host`, no sky background or vignette, and a sun sized to the viewport.
- Mounted in `shell/TableView.tsx`: no map (231 to 236, `div.table-claim > <ClaimCharacter art/>`), map live (189 to 195, `section.table-panel.table-panel-claim` "Choose your character"; CSS `table/table-panel.css` 123 to 131).
- The builder's gate: `shell/LayerView.tsx` 51 to 62 ("Your GM builds the characters at this table. Ask them to make you one, or claim one that's already on the table." and Back to the table).

### 3.3 The join address and the empty table

- `components/JoinAddress.tsx` (159 lines): `joinCandidates` (16 to 19), `copyText` (22 to 42), `JoinAddress({ token, layout })` (49 to 147; fetches `HOST_PATHS.joinUrls`; the no-address message 82 to 89; `strip` 113 to 122; `hero` and `row` 123 to 146 with Copy, Show or Hide QR code and "Phones on the same Wi-Fi open it or scan the code."; `QrCode` 140 to 144). CSS `components/join-address.css` (88 lines).
- Where it renders: `shell/TableView.tsx:138` (hero, GM, no map), `table/TableStrip.tsx:76` (`JoinButton` 136 to 148, the phone's "Join the table" sheet) and 105 (strip, laptop, map live), `settings/PlayersSection.tsx` 71 to 73, `actors/PartyRosterTab.tsx:297`.
- The empty table: `shell/TableView.tsx` 120 to 140 (`.map-empty-hero`, "No map loaded yet", the GM's line, the hero join address, Prepare an encounter to `SCENES_PATHS.newScene`); CSS `table-view.css` 95 to 117 and `styles.css` 337 to 377.
- What the GM's view knows: `ownerSessionId` (`packages/schemas/src/index.ts:2838`), `playedAtTable` (3050), `GmActor.presence` (`packages/domain/src/views.ts:400`; online, reconnecting or offline, set only when a character is claimed, `apps/server/src/projections.ts` 1190 to 1205). A connected player who has claimed nobody is not in the GM's view. Helpers in `actors/actor-display.ts`: `presenceDot` 6 to 8, `presenceLabel` 10 to 12, `CLAIM_WORD` 26 to 30, `claimStateOf` 33 to 36; the bar's `Connected` (`shell/AppBar.tsx` 144 to 170).

### 3.4 Tests that pin it

- `shell/landing.test.tsx`: Show password (27), the Switch and Enter table (38), Forgot the password and "Reset the GM password" (48), first run (59), "Join as Player" and "Enter as GM" disabled while resuming (70). `shell/landing-ink.test.tsx` 70 to 95 (button contrast in each theme, loads `landing.css`). `packages/ui` `button-ink.test.tsx:44`.
- `actors/claim-character.test.tsx`: `pickLine` (35), the radio rows, the claimed sentence, "1 of 3 characters are claimed.", "Pick a character to play", "Play as Borin", "Claim Borin Stoneguard?", the command (45 to 75), the released Alert (77). `table/people-light.test.tsx:134` (`.claim-row-edge`, `[data-actor='a']`).
- `components/join-address.test.tsx` (34: region "Join address", "Players join at", "Show QR code", the QR image name, Copy, the toast; 56: no address).
- `e2e/journeys.spec.ts`: first run and sign-in (79 to 110), the join address (116 to 129), joining and claiming (132 to 143, 202 to 230; the listitem text `/^Elf Wizard 7 · HP \d+$/`), Prepare an encounter (163), no `.landing` after entry (938, 997). `e2e/smoke.ts`: `signInAsGm` 211 to 217, `joinAndClaim` 224 to 233.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part | New or changed | Built from |
| --- | --- | --- |
| The title layout | Changed: the logo high in the sky, the buttons below the horizon, a smaller sun | `Landing`, `landing.css` |
| The scene's horizon | Changed: one `--landing-hz` property for the skyband, mountains, horizon and grid | `landing.css` |
| The sign-in card | Restyled: the Dialog pattern with the GM violet edge, below the horizon | `Landing` |
| `actors/ClaimCard.tsx` | New: one character's card | `ActorPortrait`, `armorClass`, `hp`, `speedFeet` from `PlayerActor` |
| The pick page | Changed: the scene behind the page, the lineup, the glass foot | `ClaimCharacter`, `LandingScene` |
| `table/Lobby.tsx` | New: the GM's empty table | `JoinAddress`, `GmView` actors, the who-plays words |
| The join block | Changed: one look | `JoinAddress` |

## 5. Phases

### B0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `B-arrival/`, and leave the other pieces' folders as the zip has them.
2. Add `B-arrival/ADR-0052-arrival.md` as `docs/adr/0052-arrival.md`, Accepted, and its row to `docs/adr/README.md`. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### B1: the title screen (Sky)

1. `landing.css`: give the scene one horizon, `--landing-hz: 64%`, used by `.landing-skyband` (`inset: 0 0 calc(100% - var(--landing-hz)) 0`), `.landing-mountains`, `.landing-horizon` and `.landing-grid` (`top: var(--landing-hz)`). Keep the grid's perspective inside the frame (its far edge must stay in front of the eye at every height).
2. The sun: `--sun-d: clamp(15rem, 23vw, 19rem)` (300 px at 1280, 240 px on a phone).
3. The layout: `.landing` stops centring its column. The hero sits in the sky with its top at 8% of the height on a laptop and 21% on a phone; the choices sit below the horizon with their top at 73% (70% on a phone). Check at 1280 by 800, 1440 by 900, 1024 by 768 and 390 by 844 that the logo never overlaps the sun (48 px clear) and the buttons never cross the horizon.
4. The buttons: "Join as a player" (the Cup) and Enter as GM, 16.5 rem by 3.6 rem; side by side 18 px apart, stacked 12 px apart on a phone with 40 px either side.
5. Fix the dead selectors: the ignition and the title size read `.nh-wordmark-cabinet` (336 to 340, 443 to 445, `styles.css:373`).
6. Tests: `landing.test.tsx` (70) and every test or journey that presses "Join as Player" (`journeys.spec.ts` 132, 202; `smoke.ts` `joinAndClaim`) read "Join as a player"; `landing-ink.test.tsx` still passes; a test that the hero sits above the horizon and the choices below it at 1280 and 390 (a layout check in the smoke suite, since jsdom has no layout).

### B2: signing in and first run (In place)

1. With `door === "gm"`, `.landing` gets `.landing--gm`: `--landing-hz` goes to 56% (48% on a phone) and `--sun-d` to 260 px (200 px), eased over 400 ms with `--ease-settle` (transition `top`, `inset` and `width`, or register the properties with `@property`); reduced motion jumps.
2. The card: the Dialog pattern (its title on the horizon edge) with the GM violet leading edge (today's `--rim-gm`), 30.5 rem wide, placed where the choices were. Its actions row: Enter table (or Set GM password) as the Cup, Back as a ghost, and Forgot the password as a link at the right (move `.landing-reset` into the row). On a phone: the full width less 14 px each side, the Cup full width, Back and Forgot the password on one row under it.
3. First run: the same card with today's words, no Switch and no Forgot the password.
4. Forgot the password stays today's Modal with `ResetSteps`, drawn as the Dialog pattern (A rule 6).
5. Tests: `landing.test.tsx` (27 to 59) keep their names; `landing-ink.test.tsx` 70 to 95 (the plate under the buttons changes); `journeys.spec.ts` 79 to 110 still passes with `expectPageFits` at 390 px.

### B3: the pick page (Lineup) and the builder's gate

1. `actors/ClaimCard.tsx`: the card (214 px wide): the portrait area (150 px) with `ActorPortrait` at its largest size on a wash of the character's colour, a Claimed `Tag` at its top right when claimed; the name in Chakra Petch 600 capitals; the class line (species, class and level, from `pickLine`'s first part); a plate of AC, HP and Speed from the `PlayerActor` fields the player already has (`armorClass`, `hp`, `speedFeet`). The card is the radio (`role="radio"`, `aria-checked`, `data-actor`, disabled when claimed), named by the character and described by the class line and HP so screen readers hear what `pickLine` says today.
2. `ClaimCharacter`: drop the `art` wrapper's `Wordmark` (rule 2). With no map, the page is the scene with no logo behind the Table page: `LandingScene` inside a host that has the sky background and vignette (`.landing-scene-host` gets the `.landing` sky and `::before`), its horizon at 50% and sun 300 px. In the sky: the h2 and the status line. On the horizon: the cards in a row, centred, 22 px apart, the chosen one raised 16 px with a cyan edge and the horizon line at its foot. The foot is a glass bar: Make a new character and Import from D&D Beyond (PDF) as Base line controls at the left, Play as {first name} as the Cup at the right.
3. A claimed card keeps today's sentence under its class line and is dimmed. The released Alert and "Nothing to claim yet" stay, as T rule 3's empty state.
4. The claim light (57 to 75) moves from the row to the card: `.claim-row-edge` becomes the card's foot line; its test follows.
5. A phone: the page header (A), the status line, the cards in a row that scrolls sideways with scroll snap (196 px wide, the chosen one first), the glass foot with the two controls over Play as full width, above the bottom tabs.
6. The builder's gate (`LayerView.tsx` 51 to 62): T rule 3's empty state with today's words and Back to the table.
7. Tests: `claim-character.test.tsx` (radios are the cards; the claimed sentence; the status; Play as; the confirm; the command), `people-light.test.tsx:134`, `journeys.spec.ts` 132 to 143 and 202 to 230 (the listitem text becomes the card's accessible description), `smoke.ts` `joinAndClaim` (radio by name).

### B4: picking with a map live

1. `TableView` 189 to 195: the panel (C) shows the same cards two to a row without the scene, the status line at the top and Play as in the panel's foot (C's foot slot). The cards drop the portrait to 96 px here.
2. Tests: the journey that claims with a map live; `panel-tabs.test.tsx` if it reads the claim panel.

### B5: the lobby and the join block

1. `table/Lobby.tsx` replaces the GM's empty hero (`TableView` 120 to 140) while no map is live. At the left: Players join at, `JoinAddress` (`layout="hero"`, the QR code at 220 px, the address picker when there are several, Copy) and its line. At the right: The party, the count ("2 of 4 claimed", VT323 cyan), one row per player character that is not archived: `ActorPortrait`, the name and class line, and who plays them with a lamp: on a player's device (cyan; from `ownerSessionId`, dimmed with `presenceLabel` when the presence is reconnecting or offline), at the table (gold; `playedAtTable`), open to claim (unlit). Under them the line and Prepare an encounter as the Cup.
2. On a phone: the Play page header (A), the QR code at 118 px beside Players join at with the address and Copy, The party and its rows, and Prepare an encounter pinned above the bottom tabs.
3. The player's empty table ("The map appears here when the GM makes an encounter live.") stays as T rule 3's empty state.
4. One join block (rule 11): `JoinAddress`'s `hero` and `row` layouts draw the lobby's block (the code, the address in VT323, Copy as a Base line control). The `strip` layout and `JoinButton` go with the strip (C1); the Encounter tab before a fight (C) and `settings/PlayersSection.tsx` use the block; the roster's copy goes in D2.
5. Tests: `join-address.test.tsx` (34, 56) keep their names; a new `lobby.test.tsx` (the count, the three who-plays words, archived characters left out, presence dimming, Prepare an encounter); `journeys.spec.ts` 116 to 129 and 163.

### B6: docs and cleanup

1. `docs/DESIGN.md`: an Arrival section beside the Look table (42): the title (the logo in clear sky, never on the sun), signing in in place, the lineup and the lobby; the empty states (336 to 338) name the lobby.
2. `docs/ARCHITECTURE.md`: identity and roles (116 to 147): the lobby reads `ownerSessionId`, `presence` and `playedAtTable` from the GM's view; the join address has one block (1065).
3. `docs/adr/README.md`: 0052 Accepted and built.
4. Remove what nothing uses: `.claim-screen`, `.claim-art`, `.claim-art-mark` and the row styles in `claim-character.css`, `.map-empty-hero`'s join rules, `join-address--strip`, the dead wordmark selectors.
5. `docs/design/polish/CATALOG.md`: B moves to Built.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- On a fresh data directory and then a signed-in one, look in Dusk and Dawn at:
  - 1280 by 800 and 1440 by 900 with a mouse: the title (the logo clear of the sun, the buttons on the grid), first run, a wrong password and its notice, sign-in, Forgot the password, the entry drive; as a player, the pick page with one character claimed elsewhere, the confirm, the toast; as the GM, the lobby filling in as a player claims, Prepare an encounter.
  - 390 by 844 with touch: the same, with the stacked buttons, the card's foot, the lineup scrolling sideways, the lobby's pinned Cup; every control at least 44 px; no sideways scroll of the page.
  - A map live: picking in the panel.
- With reduced motion (no drive, no scene easing) and reduced transparency (the glass foot solid).

## 7. Left as they are, for later rounds

- The table screen's own join and pairing pages (area H).
- The roster (D), the Encounter tab's other parts (C3), Settings' Players section beyond the join block (area I).
- Every command, projection and stored value.

## 8. Departures from the mockup, on purpose

- The mockup's character art is drawn emblems; the build uses `ActorPortrait`.
- The mockup draws a claimed card without today's sentence; the build keeps it (`SPEC.md` 2.3).
- The mockup's lobby shows who plays without presence; the build dims a claimed character whose player is reconnecting or offline, from the GM's view.
- The mockup does not draw errors and notices, the address picker for several addresses, the released Alert, "Nothing to claim yet", the Forgot the password dialog or the entry drive; section 5 places them.
- The mockup's title button says "Join as a player"; today's says "Join as Player". The build follows the mockup and updates the tests.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `arrival.html`.

- `p4e-arrive.css`: the scene (`.b-scene`, `.b-sun`, `.b-mtn`, `.b-hzl`, `.b-grid`, copied from `landing.css` with a variable horizon and sun), the wordmark (`.b-mark`), the buttons (`.b-cup`, `.b-gm`), the card (`.b-plate.gm`), the lineup (`.b-lineup`, `.b-lcard`, `.b-skyhead`, `.b-glassbar`), the lobby (`.b-lobby`, `.b-seat`, `.b-tableempty`) and the phone (`.b-ph`).
- `p6-arrive.js`: `scene()`, `mark()`, `title()` (the `sky` branch), `signin()` (the `place` branch, `words()` for first run), `pick()` and `lcard()` (the `lineup` branch), `invite()` and `seat()` (the `lobby` branch), the decisions in `DEC` and the rules in `renderStatic()`.
- `p2b-mobile.css` and the end of `p6-arrive.js`: the mockup page's own phone bar and laptop view; mockup code only.
- `audit-b.js`: the "Today" screenshots.

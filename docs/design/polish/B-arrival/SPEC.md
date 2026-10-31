# B. Arrival: the title screen, signing in, picking a character and inviting players

Approved by the owner on 2026-10-29 after two rounds of mockups. Area B in `../CATALOG.md` gets a person into the right
seat: the title screen, the GM's sign-in and first run, a player picking who to play, and the GM telling players where
to join. It inherits the theme (`../T-theme/SPEC.md`), the frame (`../A-frame/SPEC.md`) and the table's frame
(`../C-table/SPEC.md`). `PLAN.md` beside this file is the work to build it; `arrival.html` is the approved mockup, and
`history/` holds both rounds as they were shown.

Round 1 was turned down whole. The owner's note, which every decision here answers: the script vtt cannot be read in
front of the sun, so the logo needs its own space.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) made the Cups words only, gave Keep me signed in the
theme's 46 by 26 switch, and drew every phone control at 44 px.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) gave the Dusk and Dawn choice its 44 px on a phone and
set the cards' AC, HP and Speed and the lobby's Players join at in the eyebrow (T 2.4).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew CLAIMED as a VT323 tag (T rule 7), the icons in
its buttons at 15 px at a 1.8 stroke (T 2.5), the lobby's lamps at 8 px (T rule 19) and the title screen's Dusk and Dawn
switch as 36 px options on its plate, and gave Dawn's amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id     | Surface                                             | Decided here   |
| ------ | --------------------------------------------------- | -------------- |
| B1     | The title screen                                    | Sky (2.1)      |
| B2, B3 | GM sign-in and setting up the GM password           | In place (2.2) |
| B4     | Forgot the password                                 | Rule 3.5       |
| B5     | The entry into the app                              | Rule 3.6       |
| B6, B7 | Picking a character, before and after a map is live | Lineup (2.3)   |
| B8     | Inviting players                                    | Lobby (2.4)    |
| B9     | The builder's gate                                  | Rule 3.10      |

## 2. The decisions

### 2.1 The title screen is Sky

- Today's scene stays exactly as `shell/landing.css` draws it: the star field, the slatted sun setting on the horizon at
  64% with 72% of its disc showing, the two mountain ranges either side of it with their cyan rim, the horizon line and
  the grid rolling toward the viewer. Dawn paints it as daybreak, as now.
- The sun is smaller: 300 px across at 1280 px wide (today 432 px) and 240 px on a phone (as today).
- The logo (OZY in chrome, vtt in the neon script, today's cabinet wordmark at today's title size) moves up into the
  night sky above the sun, centred, with at least 48 px of clear sky between it and the top of the sun. Nothing sits
  behind it but sky and stars.
- The two buttons stand on the grid below the horizon, centred: Join as a player (the Cup, first) and Enter as GM (the
  raised control with the GM violet on its leading edge, as today). Side by side on a laptop, stacked full width on a
  phone with 40 px either side.
- The theme switch stays at the bottom right.

### 2.2 Signing in is In place

- Enter as GM turns the buttons into a card in the same place, below the horizon. The scene eases up to make room: the
  horizon to 56% (48% on a phone) and the sun to 260 px (200 px on a phone), with the logo still in clear sky above it.
  With reduced motion it jumps.
- The card is the Dialog pattern with the GM violet on its leading edge (today's card): the title on the horizon edge
  ("GM sign-in"), one line ("Enter the GM password to run the table."), the password field with Show, Keep me signed in
  on this computer as a Switch, then Enter table as the Cup, Back as a ghost and Forgot the password as a link at the
  right. 488 px wide on a laptop; on a phone the full width less 14 px each side, the Cup full width, and Back and
  Forgot the password on one row under it.
- First run is the same card: "Set up the GM password", today's line about at least 12 characters set on this computer,
  the field with Show, Set GM password as the Cup and Back. No Keep me signed in and no Forgot the password.

### 2.3 Picking a character is Lineup

- A player who has joined and has no character sees the Table page (inside the frame, A) with the sunset behind the
  page: the scene with no logo (rule 3.2), its horizon at 50%, the sun 300 px.
- In the sky at the top: Pick your character (Chakra Petch capitals, 30 px) and the status line with its lamp ("1 of 4
  characters are claimed.", today's words).
- The party stands on the horizon as tall cards, side by side and centred, 214 px wide and 22 px apart:
  - the portrait (150 px tall), today's `ActorPortrait` art on a wash of the character's colour, with a Claimed tag at
    its top right when someone else plays them;
  - the name in Chakra Petch 600 capitals, the class line (species, class and level);
  - a plate of AC, HP (gold) and Speed in VT323 over small labels.
- The chosen card steps forward 16 px with a cyan edge and the horizon line along its foot. A claimed card is dimmed and
  cannot be chosen (rule 3.7); it keeps today's sentence ("Claimed on another device. Ask the GM to release it."). One
  open character is chosen from the start, as today.
- A glass bar along the foot: Make a new character and Import from D&D Beyond (PDF) as Base line controls at the left
  (rule 3.9), Play as Mirena as the Cup at the right.
- On a phone: the page header (A), the status line, the cards in a row that scrolls sideways (196 px wide, the chosen
  one first and raised), then the glass foot with the two Base line controls over Play as Mirena full width, above the
  bottom tabs.
- With a map live (B7) the same cards sit in the table's panel (C), two to a row and without the scene, with Play as in
  the panel's foot.

### 2.4 Inviting players is the Lobby

- While no map is live, the GM's empty table is the lobby. It replaces today's hero ("No map loaded yet", the join
  address and Prepare an encounter).
- At the left: Players join at, the QR code (220 px) drawn on this device as today, the address in VT323 with the
  address picker when there are several, Copy, and one line: "Phones on the same Wi-Fi as this computer open it, or scan
  the code."
- At the right: The party, with the count in VT323 cyan ("2 of 4 claimed"), then one row per player character: the
  portrait, name and class line, and who plays them with a lamp, in the roster's words (D rule 4): on a player's device
  (cyan), at the table (gold) or open to claim (unlit). The rows fill in as players claim. Under them a line ("The party
  fills in as players claim their characters.") and Prepare an encounter as the Cup.
- On a phone: the Play page header (A), the code (118 px) beside Players join at, the address and Copy, then The party
  and its rows, and Prepare an encounter pinned above the bottom tabs.
- Once a map is live, the lobby's join block (code, address, Copy) is the one used everywhere else: in the Encounter tab
  before a fight (C) and in Settings, the Players section (rule 3.11).

## 3. Rules for arrival

1. The logo has its own space. The wordmark never sits on the sun or on a picture: it stands in clear sky, so OZY and
   the script vtt both read.
2. One logo. The wordmark shows on the title screen and while signing in. Once someone is in, the bar carries it (A) and
   the scene shows the sun alone, with no logo over it (today's pick page repeats it over the sun).
3. The scene is the app's. Every arrival surface uses today's sunset from `shell/landing.css`; only the sun's size and
   the horizon's height change, by the values in section 4.
4. The theme switch stays at the bottom right of the title screen. Once signed in it is in the menu (A).
5. Forgot the password opens today's reset steps as a Dialog (A rule 6): stop OzyVTT, delete the auth file, start it
   again. The words stay as they are.
6. The entry keeps today's drive into the app (ADR-0045); reduced motion cuts straight to it.
7. A claimed character is shown, not offered: dimmed, with a Claimed tag, and cannot be chosen. A player sees only the
   characters the projection lists for them.
8. Claiming confirms once, in the Dialog pattern: "Claim Mirena Dawnbright?" with Cancel as a ghost and Claim as the
   Cup.
9. Make a new character shows only while the GM allows players to build; Import from D&D Beyond (PDF) sits beside it.
   Both are Base line controls.
10. The builder's gate is T rule 3's empty state with today's words ("Your GM builds the characters at this table. Ask
    them to make you one, or claim one that's already on the table.") and Back to the table.
11. One way to invite. The lobby's join block is the only look for the address: on the empty table, in the Encounter tab
    before a fight (C) and in Settings. The roster drops its copy (D) and the phone strip's Join sheet goes with the
    strip (C).

## 4. Values

| Part          | Value                                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title scene   | Horizon 64%; sun 300 px at 1280 px (`--sun-d: clamp(15rem, 23vw, 19rem)`), 240 px on a phone                                                                            |
| Title logo    | Today's sizes (`.home-hero-mark`); its top at 8% of the height on a laptop and 21% on a phone; at least 48 px above the sun                                             |
| Title buttons | 264 by 58 px; 18 px apart side by side; stacked 12 px apart on a phone with 40 px either side; their top at 73% on a laptop and 70% on a phone                          |
| Sign-in scene | Horizon 56% and sun 260 px on a laptop; 48% and 200 px on a phone; eased with `--ease-settle`, 400 ms                                                                   |
| Sign-in card  | 488 px; the Dialog pattern with a 4 px GM violet leading edge; padding 22 px 24 px 20 px 28 px; 14 px between rows                                                      |
| Lineup scene  | Horizon 50%, sun 300 px, no logo                                                                                                                                        |
| Lineup card   | 214 by about 300 px, 22 px apart; portrait 150 px with the art at 84 px; name 16 px; plate cells in VT323 22 px; chosen lifted 16 px with a 1 px cyan edge and its glow |
| Lineup foot   | Glass bar, 14 px 20 px; the Cup at the right                                                                                                                            |
| Lobby         | Two columns 64 px apart, 150 px in from each side on a laptop; code 220 px; address VT323 28 px; party rows 60 px with a 40 px face; count VT323 cyan                   |

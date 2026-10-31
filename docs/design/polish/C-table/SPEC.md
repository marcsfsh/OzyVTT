# C. The table: its frame

Approved by the owner on 2026-10-29 in one round of mockups. Area C in `../CATALOG.md` is the largest area, so it is
designed as one frame first and then its groups. This spec is that frame: how the map, the tools, the turn order and the
panel share the screen, how the turn order reads, how a turn is taken, and how the table fits a phone. It inherits the
theme (`../T-theme/SPEC.md`) and the frame around every page (`../A-frame/SPEC.md`). `PLAN.md` beside this file is the
work to build it; `table.html` is the approved mockup, and `history/` holds round 1 as it was shown.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) drew the Base line buttons at 36 px and every phone
control, the switch's options included, at 44 px.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) drew Mark used at 36 px (T 2.5) and the option table's
heads in the eyebrow at 11 px (T 2.4).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew a harmful condition as the one tag, VT323 16 px in
its 22 px box (T rule 7), the panel's tabs at 44 px (T rule 1) and lamps at 8 px (T rule 19), and gave Dawn's amber,
magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id                    | Surface                                            | Decided here                 |
| --------------------- | -------------------------------------------------- | ---------------------------- |
| C1.1, C1.3            | The table workbench and its panel                  | Two docks (2.1)              |
| C1.2, C3.5            | The table strip and the turn order                 | Ladder (2.2); the strip goes |
| C2.2, C2.4            | The tools and the staging tray                     | Placed by 2.1; rule 3.4      |
| C3.4, C4.2            | The GM's acting console and the player's turn card | Cost tabs (2.3)              |
| C4.5, the phone table | The phone's table                                  | Switch (2.4)                 |

Left for the groups' own rounds: the map's menus and each tool's options (C2), setting up and running an encounter
beyond the turn (C3.1 to C3.3, C3.6 to C3.12), prompts, rests and the replay shelf (C4.3, C4.4, C4.6), the log and dice
(C5) and the encounter dialogs (C6). Each is designed inside this frame.

## 2. The decisions

### 2.1 The laptop workbench is Two docks

- Under the top bar, three columns: a left dock of 232 px, the map, and the panel docked at the right, 380 px.
- The left dock holds the turn order as a column (2.2), filling its height and scrolling itself, and under it the map's
  tools as a two-column grid of icon and word (46 px rows). The GM's tools and a player's are today's sets.
- The map has nothing over it but its own things: the tokens, the Tray chip (rule 3.4) at its top left and its controls
  at its bottom right (rule 3.6).
- The panel has one row of tabs (GM: Encounter, Log, Party, Notes, and Token while a token is chosen; a player: Turn,
  Sheet, Log and Party in a fight, Me, Log and Party before one, as today), its content scrolling, and its foot holding
  the one primary (rule 3.1).
- From 980 to 1279 px the dock narrows to 72 px: each row shows its face and initiative with the acting ink, a pointer
  or focus on a row shows it whole, and the tools are icons alone. From 1280 px it is the full dock. Below 980 px the
  table is the phone's Switch (2.4), under the top bar on a tablet.
- The strip across the top of the map goes: the round moves to the head of the turn order, the encounter picker is the
  top bar's live chip (A), Me is the map's centre control, and the strip's Encounter menu, Now Playing and Join move
  into the Encounter tab.

### 2.2 The turn order is a Ladder

- The head of the column: the round on the VCR counter: `PLAY ▸ RND 02` while a fight runs, `STOP ■ RND --` before.
- Each combatant is a row of at least 52 px, on 1 px `--line` dividers: the face (34 px, a `--party` edge for the party,
  `--hostile` for foes), the name (13.5 px, 600), its initiative in VT323 18 px at the right, and under the name its hit
  points and conditions.
- Hit points by role: the GM sees a 4 px bar for everyone (gold for the party, red for foes). A player sees the party's
  bars and a foe's health band as its word (Healthy, Bloodied or Down) in 11.5 px `--text-muted`, as the projection
  gives it.
- Conditions are small tags after the bar; a harmful one has a danger edge.
- The acting row is tinted `--caution` at 7 %, its initiative turns amber, and the horizon ink lies down its left edge
  (2 px, as a vertical chosen tab's). NEXT, in VT323 11 px, sits under the next combatant's initiative.
- Before the fight the rows show the staged combatants with `--` for initiative and no acting row.
- On a phone the same rows turn into cards 150 px wide in one line that scrolls sideways under the header, the acting
  card inked along its bottom.

### 2.3 A turn is taken through Cost tabs

- One design for the player's Turn tab and the GM's Encounter tab, for whoever acts.
- The head: for the player on their turn, YOUR TURN in Bungee chrome (rule 3.2) with hit points and AC at the right; for
  the GM, the acting creature's face (44 px), its name in Chakra Petch 600 capitals at 19 px, a line ("Acting · you run
  it" for a monster, "Acting · from the player's device" for a character) and its hit points in VT323 with AC.
- The economy is four tabs in one row: Action, Bonus Action, Reaction and Move. Each Action, Bonus Action and Reaction
  tab shows its lamp (11 px; magenta, gold, cyan), its name and its state in VT323 (READY, USED, NOT NOW). The Move tab
  shows the feet left in VT323 19 px over "Move". Each tab stands on a Base line and the chosen one on the 2 px cyan
  line: the cost tabs are the turn's one view switch (theme rule 1), so the horizon ink stays the panel's own. A spent
  lamp goes dark. A creature with Legendary Actions gets a fifth tab, Legendary, with how many are left.
- Under the tabs, the chosen cost's state, "Action · ready", with Mark used (or Mark ready) at the right: the toggle the
  lamps are today.
- The chosen tab lists the options that cost it. Each option is one row and one button, as the Ledger sheet draws
  actions: the name (14 px, 600) with a line under it, then range, hit or DC and damage in columns (62, 48 and 84 px;
  VT323 for the numbers), with one header row. On a phone the range joins the line under the name.
- In each tab, favourites (today's pins) come first with a small star. After the Action tab's list come the options that
  cost nothing, then "Anyone can" and the common actions (Dash, Disengage, Dodge, Help, Hide, Ready) as Base line chips,
  then Edit favourites. A monster's traits follow as an open group.
- The tab opens on Action at the start of a turn, moves to the next unspent cost when one is spent, and stays where the
  person puts it.
- Off their turn a player sees a line, "Goblin Boss is acting. Your turn comes after Borin.", with Action and Bonus
  Action marked NOT NOW and the Reaction tab chosen, listing their reactions.

### 2.4 The phone table is a Switch

- Under the header row (A), a segmented control on Base lines: Map, Turn, Log, Party for a player (Me in place of Turn
  before a fight); Map, Encounter, Log, Party, Notes for the GM. It is the phone's row of tabs, so the cost tabs inside
  Turn are still the one view switch under it. Under it, the turn order as cards (2.2), then the chosen view filling the
  rest, with the panel's foot pinned above the bottom tabs in every view, so End turn is always in reach. A chosen
  token's details (the GM's Token tab) open over the Map view; C3.10 designs them.
- Map: one row of tools that scrolls sideways (the active tool inked along its bottom), then the map at full height with
  its controls in the corner. Turn: 2.3. Log: the log and its composer. Party: the party with their hit points.
- It opens on Turn (Encounter) while a fight runs and on Map before one, remembers the last choice on the device, and
  turns to Turn when the player's turn starts.

## 3. Rules for the table

1. One primary, in the panel's foot: End turn while a fight runs, Start the encounter before one, as the Cup (theme rule
   2). The GM has Back (to the previous turn) beside it as a Base line control, and "Next: Goblin Warrior 1" sits under
   it in 12.5 px `--text-muted`. Off their turn a player's foot says when their turn comes, with no button.
2. YOUR TURN in Bungee chrome appears once, at the top of the player's turn. Every other acting name is Chakra Petch.
3. The economy is four lamps and no boxes: Action magenta, Bonus Action gold, Reaction cyan, Movement as a VT323 count.
   A spent lamp goes dark with its afterglow (ADR-0045).
4. The staging tray is a chip at the map's top left, "Tray" with how many waiting in VT323 amber. It opens the tray; it
   never pushes the map down.
5. Hit points by role: the GM sees every number; a player sees the party's and a foe's health band as a word (Healthy,
   Bloodied, Down), as the projection gives them today.
6. The map's own controls (centre on me, zoom out, zoom in) sit together in glass at its bottom right on every size.
7. The acting token wears an amber ring on the map, the acting row the ink in the order, and the turn says who acts.
   Amber means waiting on someone (theme rule 9).
8. The panel has one row of tabs. The GM's Token tab shows only while a token is chosen. Notes holds Tonight and the
   Codex without a strip of its own (C3.9 designs it).

## 4. Values

| Part         | Value                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Left dock    | 232 px; the order fills it and scrolls; tools grid 2 columns, 46 px rows, icon 18 px and word 11 px                    |
| Round head   | 12 px 14 px padding; VT323 26 px `RND 02` after `PLAY ▸` in 13 px                                                      |
| Ladder row   | At least 52 px; 6 px 12 px padding; face 34 px; name 13.5 px 600; initiative VT323 18 px; bar 4 px; wound word 11.5 px |
| Panel        | 380 px; tabs one row; body 12 px 16 px; foot 12 px 16 px 10 px with a 50 px Cup and a 44 px Back                       |
| Turn head    | Face 44 px; name Chakra Petch 600 19 px capitals; hit points VT323 26 px in `--hp-text`                                |
| Cost tabs    | Four equal tabs; lamp 11 px; label 12.5 px 600; state VT323 14 px; Move count VT323 19 px                              |
| Option rows  | At least 48 px; columns 1fr, 62, 48 and 84 px; one header row in the eyebrow, 11 px capitals                           |
| Phone switch | Segmented, four equal options on base lines, 44 px faces; order cards 150 by 64 px                                     |
| Phone tokens | 34 px (40 px for a large creature), no label under them                                                                |

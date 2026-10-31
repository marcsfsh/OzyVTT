# F The story and people

Approved by the owner on 2026-10-30 after one round of mockups. Quests (F5.1), relationships (F5.2), a faction's
standing (F5.3), adding to the chronicle (F4.5) and where downtime sits (F4.7) in `../CATALOG.md`, inside the Codex's
frame (`../F-codex/SPEC.md`). They inherit the theme (`../T-theme/SPEC.md`), the frame (`../A-frame/SPEC.md`), the side
column's swap (`../F-finding-pages/SPEC.md` rule 3) and the folders at the side (`../E2-maps-tokens/SPEC.md` 2.1).
`PLAN.md` beside this file is the work to build it; `story-and-people.html` is the approved mockup, and `history/` holds
the round as it was shown. Every decision is built from settled parts; the mockup's Carried in section lists them.

The second sweep (`../T-consistency/SPEC.md` section 5, ADR-0073) made New quest a Base line button, the quests' toolbar
count plain words, the story's phone header CODEX, and the find field's placeholder muted.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) made Cancel a ghost in every foot, drew a faction's
tiers at 44 px on a phone, and set the reading measure at 680 px.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) gave a faction's page on a phone the header ‹ PAGES
and no strip (T rule 12) and set its sheets' titles at 20 px (T 2.2).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew the chronicle's date bar as a Cradle (T 2.4), the
downtime's DAYS and DAYS LEFT in the eyebrow (T 2.4), the tabs at 44 px (T rule 1) and every tag in a 22 px box (T rule
7), and gave Dawn's amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id   | Surface                 | Decided here                                                                 |
| ---- | ----------------------- | ---------------------------------------------------------------------------- |
| F5.1 | Quests                  | Status at the side (2.1)                                                     |
| F5.2 | Relationships           | A ring on glass (2.2)                                                        |
| F5.3 | A faction's standing    | In the side column (2.3)                                                     |
| F4.5 | Adding to the chronicle | At the head of the line, filed under any session (2.4)                       |
| F4.7 | Downtime and deadlines  | A Downtime tab on the story (2.5), its contents in `../F3-atlas/SPEC.md` 2.5 |

The calendar editor (F4.4) and a timeline record (F4.6) keep today's dialogs, drawn as A's dialog (rule 3.6).

## 2. The decisions

### 2.1 Quests put their statuses at the side

- Two columns, as the pages index (F2 2.2): at the left (240 px) STATUS (All quests, Active, Not started, Done) and WHO
  SEES IT (Everyone, Hidden) with counts in VT323, the chosen one lit; at the right the toolbar (Find a quest, the count
  in plain words ("2 active quests"), Changed with the sort icon, New quest as a Base line button, since the Codex bar's
  New is the Cup) and the quests as rows.
- A quest's row: the quest icon, its name and its line, its progress (a 4 px line and "1 of 3" in VT323), who sees it,
  and More. A hidden quest's name is violet with its Hidden tag (F rule 2).
- A quest opens as a page (F 2.2): the title row (Quests as a crumb, the name, its status tag, "Revealed to everyone · 1
  of 3 done", Edit and More), the text, Objectives (each a check, its text, and who sees it; a hidden objective violet
  with Reveal), Add an objective, and the side column of Facts (Status, Progress) and Linked pages.
- A player's list has the statuses with plain counts and no Who sees it; hidden quests and objectives never reach them.
- On a phone: the statuses as chips with their counts, the rows under them.

### 2.2 Relationships are a ring on glass

- The ring takes the whole page under the Codex's bar: the centred page in the middle (its face larger) and each tie's
  page around it, each line named at its middle ("Leads it", "Hunts"); a hidden tie's line and name are dashed violet.
- On glass over it: Centre on (a field with the page and its menu) at the top left; Web, Factions grid and Over time as
  a segmented control at the bottom left; and the ties at the right (320 px): "The Ashen Hand's ties · 5", each tie a
  row (its face, its name, the tie and what the page is, and More, or Hidden), Add a tie, and today's line on hidden
  ties.
- Choosing a tie lights its row and its line. More than eight ties: the ring keeps eight and the ninth position reads
  "+3 more", which lights the list.
- Factions grid and Over time keep today's views, drawn under the same glass.
- On a phone: Centre on and the views under the bar, the ring, and the ties as a sheet from the foot ("5 ties").

### 2.3 A faction's standing opens in its page's side column

- On a faction's page, Standing (in the side column's facts, and from the Factions grid's cell) turns the side column
  into the standing (F2 rule 3): Back and STANDING TOWARD THE PARTY, the word large with its number and the new one
  ("HOSTILE −52 → −47"), steps of −10, −5, +5 and +10, the seven words with their ranges and the current one lit
  (choosing a word moves the number to its middle), Why it moved with today's line, and Record change as the Cup.
- Recording writes once through today's route and closes the column; the page's facts show the new word.
- On a phone: a Standing tab beside Overview and Relations with the same parts.

### 2.4 Adding to the chronicle opens at the head of the line

- Add to the chronicle opens the composer at the top of the chronicle, above the first session: Entry, Deadline,
  Downtime and Milestone as a segmented control; FILED UNDER with the session as a menu and the in-world date as a menu;
  the text; Hidden note and Link a page as options under it; Cancel and Add entry (or Add deadline, Log downtime, Add
  milestone) as the Cup.
- The session menu lists every session (number, real date and in-world date, the planned one marked "Planned · next")
  and Not in a session, the active one chosen first, as today's Session field does.
- While composing, each session in the line has Add here at the right of its heading, which files the entry under that
  session.
- Each kind shows only its own fields under the same head (a deadline's due date, downtime's who and how many days).
- On a phone: the same composer at the top of the Chronicle tab, Filed under as two menus under the kinds.

### 2.5 Downtime gets a tab on the story

- The story's tabs become Chronicle, Timeline, Sessions and Downtime. The Downtime card leaves the Chronicle's side
  column.
- What the tab holds was decided in the next round: the characters at the side (`../F3-atlas/SPEC.md` 2.5).

## 3. Rules for the story and people

1. Standing reads as a word: Hunted, Hostile, Unfriendly, Uninvested, Friendly, Allied or Exalted first, the number
   after it in VT323, never a bar or a colour alone.
2. Hidden reads one way (F rule 2) for quests, objectives, ties and entries; players never receive them.
3. Nothing new in what the controls do: every quest, objective, tie, standing, entry, deadline and downtime keeps
   today's routes and words.
4. Any session can take an entry: Filed under and Add here offer every session and Not in a session.
5. Dates are the campaign's: deadlines and downtime count days on its calendar.
6. The calendar editor and a timeline record keep today's dialogs, drawn as A's dialog, until a later round.
7. Phones: one column; groups as chips; menus, dialogs and the ties from the foot; 44 px hit areas.

## 4. Values

| Part              | Value                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Quests' side list | 240 px; rows 38 px; counts VT323 16 px; quest rows at least 58 px; progress line 4 px, 120 px                                   |
| The ring          | Radius 240 px at 1280 by 800; the centred face 68 px, the others 50 px; line labels 11.5 px 600 on the page colour              |
| The glass         | T's glass; the ties 320 px wide, 16 px from the edges; tie rows at least 52 px with 34 px faces                                 |
| Standing column   | 360 px (F 2.2's side column); the word 26 px Chakra Petch capitals, the numbers VT323 22 px; word rows 40 px (44 px on a phone) |
| The composer      | Full width of the line; its area at least 64 px; a 2 px cyan line under it while open                                           |

# ADR-0030: The character sheet remaster

## Status

Accepted, 2026-10-17. Supersedes how [ADR-0021](0021-player-character-sheet.md) laid out the play sheet. That sheet
was one header over one long scroll, with the roll settings at its top. Equipped weapons were chips to tap and roll
(part (b) of its v6 amendment); a weapon attack is now an option on the Play tab and the turn card, and an item's
detail. ADR-0021's data model, its split between the definition and the live actor, its authorization seam and its
later amendments stand. The server pieces this sheet reads are recorded here too.

## Context and decision drivers

The design research measured the old sheet on the built app:

- On a phone the header, the roll settings and the latest roll took 358 of the 796 pixels under the app bar. A level
  9 Wizard's actions began 23 screens down a 13,150-pixel scroll.
- In a fight the table's Sheet tab on a phone had a scroller 20 pixels tall, so it showed no sheet.
- Concentration wasn't on the sheet, and the Death Saving Throws left it in a fight.
- A spell could appear three times: in Spells, in Actions and on the Turn tab. The Turn tab listed riders and spells
  that weren't prepared with no grouping by cost, and a disabled Cast gave no reason.
- The GM's controls looked like the player's. A multiclass character's Hit Point Dice showed one die size. Weapon
  masteries were only in the trait text. The latest-roll line showed the builder's Hit Point roll.

The drivers: phones are first-class (390 by 844 with touch), and the turn is a tap or two away there. The table's
panel keeps the tabs ADR-0025 built. Every number and every reason comes from the server, and a field reaches a
projection only when everything it carries is public to that audience. Every capability of the old sheet keeps a
home.

## Considered options

Three directions were mocked up for the same evening of play on six screens: the GM's laptop and phone, the player's
phone and laptop on My character, and the table's panel on a phone and on a laptop.

1. **A. Tabbed sheet.** A pinned header with the four numbers read most and a strip of every live state, then six
   tabs: Play, Checks, Spells, Gear, Features and Notes. The tabs sit under the thumb on a phone, and a laptop gets
   three columns. Each tab is a few screens long, and the table's panel stays as built. On a phone a check from
   another tab is a tab change, and the table's panel has two rows of tabs.
2. **B. One scroll.** The order of the 2024 paper sheet with a sticky index, and everything at once in three columns
   on a laptop. It is the smallest build. A phone still scrolls about 6,700 pixels, and it merges the panel's Turn
   and Sheet tabs.
3. **C. Now and library.** One card for the moment (between fights, the turn, a cast, dying) over a library of pages.
   It gives the clearest turn on a phone, with favourites under the thumb. Everything else is two taps away, and it
   replaces the panel's Turn and Sheet tabs.

## Decision

The owner chose A as the base for every view, with a few phone views from B and C. "Player phone" covers the player's
phone on My character, the sheet page on a phone (the same component) and the table's panel on a phone.

| Moment              | Player phone                         | Every other view                     |
| ------------------- | ------------------------------------ | ------------------------------------ |
| Between fights      | A, with B's Vitals on top of Play    | A                                    |
| Rolling a check     | A                                    | A                                    |
| Your turn           | C's turn card                        | A's Play list grouped by cost        |
| Casting with a slot | C's cast card, in place              | A's cast detail in the right column  |
| Spells              | B's spell list inside A's Spells tab | A                                    |
| Inventory           | A                                    | A                                    |
| Features and uses   | A                                    | A                                    |
| At 0 HP             | A                                    | A                                    |
| Levelling up        | B's Level box and its panel          | A's Level up and Level down in menus |

What that means on the sheet:

- **The frame.** A pinned header holds the avatar, the name, the identity line and the sheet menu, with tiles for Hit
  Points (with its bar), AC, Speed and Initiative. A status strip under it carries Concentration with its time left,
  the conditions, Heroic Inspiration while held, Exhaustion with what it costs, and timed effects. A phone has the six
  tabs as a bar at the bottom; the GM's phone swaps Notes for a violet GM tab. A character with no spells has no
  Spells tab, and each device remembers the last tab. The Hit Points tile opens a drawer to change Hit Points from
  any tab.
- **A laptop.** From 980 pixels wide the header is a band (AC, Initiative, Speed, Proficiency, Passive Perception,
  Heroic Inspiration, Rest and the menu) over three columns. The left column has the abilities with Check and Save,
  the skills and the senses. The middle has the tabs without Checks. The right column has the Hit Points card, Hit
  Point Dice per die, the GM tools box and whatever detail is open: a cast, an item, a copy or the level note.
- **The table's panel.** The panel keeps ADR-0025's tabs. Its Me or Sheet tab shows one compact row (a Hit Points chip
  that opens the drawer, AC, Initiative, the live states, the Level box and the menu) and the sheet's tabs as a
  segmented strip. In a fight the strip drops Play, which the Turn tab shows.
- **The sheet menu.** Level up and Level down (a laptop's; the Level box has them on a phone), Edit names, Token image,
  Roll settings and, for a player, Release. On a laptop Dock dice, Pop out and New tab are here too.
- **The latest roll.** A line under the header shows the last roll made from this sheet in this session, with Reroll
  while Heroic Inspiration is held. The sheet keeps the ids of its own rolls, and the builder's rolls carry their own
  purpose, so another sheet's roll and a builder roll stay out of it.
- **Play.** Between fights it has the rests, Hit Point Dice, the pinned checks with Edit, the spell slots left and the
  uses a rest gives back. On a phone B's Vitals take the top: a Hit Points box with Damage and Heal; tiles for AC,
  Initiative, Speed and Passive Perception; Hit Point Dice as boxes; Heroic Inspiration and Exhaustion; conditions
  with Add; Short Rest and Ask for a Long Rest. In a fight a laptop lists the options grouped by cost (Action, Magic
  action from items, Bonus Action, Reaction) with the server's reason on each one that can't be used now. At 0 HP
  Play opens with the Death Saving Throws card. Rest controls are hidden in a fight.
- **The turn card** (phones). "Your turn" with the round, then up to eight favourite tiles two to a row. Each tile
  says its cost in words and its left edge takes the cost's colour. "All N options" opens the full list in place, and
  Edit favourites pins and unpins. Until the player pins any, the tiles are the options this character uses most,
  then four actions, a Bonus Action and a Reaction from a fixed order. Off the turn the card names who acts, and only
  a Reaction stays live.
- **The cast card.** One component, placed by width. On a player's phone it takes the place of the card or the tab
  body: the spell's line, a grid of slot levels with what each buys and why a level can't be used, one line on what
  happens next, and "Cast at level N". On a laptop and for the GM it sits in the right column, and on the GM's phone in
  a drawer. In the table, Cast moves on to targeting as built.
- **Spells.** Prepared, Spellbook and Rituals views with slot pips on each level heading and C and R tags. On a phone
  each row starts with B's circle: cyan when prepared, indigo when a feature keeps it prepared or for a cantrip, and
  empty when it is only in the book. The prepare step after a Long Rest is a caution card with the count and Done.
  Copy a spell is a panel with its real costs. Both looks share one data model.
- **Gear.** Attunement with its count, the coins as one row with Edit, what is worn or held, the pack, and Add an item.
  A row is the name, one line and the charges as boxes. Equip, attune, quantity, Give to and Remove live in the item's
  detail, a drawer on a phone and the right column on a laptop. The detail's primary is the item's own action.
- **Features.** The uses with their boxes, when each returns and Use. Then Weapon Mastery as its own block, the
  features grouped by where they come from with the full text a tap away, and what the next level brings with Level
  up when the builder policy allows it.
- **Notes.** Species and size, background, languages, training, tools, senses and the actor's notes.
- **The GM.** The same sheet in a large dialog on a laptop, with a violet GM tools box, and the GM tab on a phone.
  Every GM-only control is violet with a GM only mark.
- **The Level box** (phones). The level beside the menu button, in the narrow header and in the table's compact row.
  It is a button only when the builder policy lets this person level, and it opens a small panel with Level up to N,
  what that level brings and Level down. The level page is unchanged.

### Server pieces

The sheet shows what the server reports and sends commands. Four pieces were added for it, and none reaches another
player, the table screen, a replay or the Codex.

**Weapon mastery on the sheet.** `actor:available-actions` names the mastery property on each swing of a weapon kind
the character chose under Weapon Mastery (`actions[].mastery`, Graze on Borin's Greatsword), from the same derivation
the resolver applies it from. The derived block lists the chosen kinds with what each property does
(`derived.weaponMasteries`, the SRD 5.2.1 text), for the Features tab. The read is owner-or-GM only, so both stay off
the broadcast projection, as the rest of the derived block does.

**Why an option can't be used now.** Each unavailable row of the same read carries `reason`, one short sentence for
the most useful of its violations: the character first (Stunned, 0 Hit Points), then the option (not prepared, no
slots, no uses), then the turn, then targeting. Every rule id has a sentence (`availability-reasons.ts`), so a new
rule doesn't compile without one. The availability check decides, and resolution checks again when the option is
used. Rows that belong off a turn list are flagged and kept, since the GM's list and the Features tab still read
them: `passive` is `rider` (Savage Attacker, Sneak Attack, Metamagic, Indomitable), `rest` (Arcane Recovery) or
`automatic` (a spell area's later save).

**What the next level brings.** `character:next-level` (`GET /game/actors/{actorId}/next-level`) reads the builder's
own survey at the next level against the character's choices ledger and answers short plain lines: the Proficiency
Bonus when it rises, the features gained, any pick no feature names, spell slots, prepared spells, cantrips, a
Wizard's two spellbook spells and the Hit Points the level adds. The level goes to the class the Level page offers
first, the class of the last level taken, and the reply names it. The GM may always ask. A player may ask only about
their own character, and only while the builder policy lets players build. A character at the table's highest level,
or one not built here, is refused.

**Favourites and use counts.** The actor gains `favouriteOptionIds` (at most 8, set by `character.set-favourites`, the
owner or the GM, each id one of the character's current turn-list options) and `optionUseCounts` (the server adds one
each time an option resolves for the character: a committed `action.resolve`, a use outside a fight, a reaction taken;
at most 32 ids, the least used giving way). Both are classified `derived` in the player projection's field map and
sent only on the owner's own character, so even the `sheet-and-resources` party tier leaves them out. The GM's view
carries the actor whole.

The builder's own rolls (Hit Points for new levels, a set of ability scores) now carry the roll purpose `builder`, and
`dice.roll` refuses it, so the sheet's latest-roll line leaves them out by purpose (ADR-0012).

## Consequences and tradeoffs

- Each tab is a few screens long, and the turn sits at the top of Play. A spell appears once on the Spells tab and
  once as an option of the turn.
- On a phone a check from another tab is a tab change. A laptop always shows the checks in its left column.
- The table's panel has two rows of tabs. Dropping Play from the sheet's strip in a fight keeps the overlap small.
- The GM's sheet is still a dialog over the table on a laptop. B's sheet docked in the Token tab was not part of the
  chosen mix.
- Favourites need a rule a player can follow: the pins in the order pinned, else the options used most, else a fixed
  fill.
- What the build doesn't match yet:
  - Items have no container field, so the pack is one group. Containers as their own groups need a schema change.
  - Hit Point Dice show per die, and Spend takes a count. The server spends a multiclass pool's biggest dice first,
    and a player can't pick the die size.
  - Give to is the GM's. No player command moves an item to another character.
  - The table's compact row keeps a Hit Points chip, so Hit Points can change from any tab in the panel. The mockup's
    row left it to the panel's bar.

## Mobile, security, and visibility impact

- Phones: the tabs sit under the thumb, the turn card puts the favourites a tap away, and the cast takes the place of
  the card so nothing stacks over it. The smoke suite has a phone journey from the turn card to the roll.
- Security: no client-side change adds a field to a projection. The sheet reads what the owner-or-GM read and the
  projections already send. The new actor fields are owner and GM only, and the projection tests prove another
  player, the table screen, a replay and every Codex read leave them out. The server still decides every roll, slot
  and target; a reason on an option is a hint, and resolution checks again.
- Visibility: GM-only controls are violet with a GM only mark wherever they sit, so the GM can tell which controls the
  player also has.

## Migration / reversibility

The client sheet moved from `apps/client/src/encounter/` to `apps/client/src/sheet/`; the old components and
`character-sheet.css` are gone. The new actor fields are additive and optional, so an old state parses. Reverting the
client leaves the server pieces unused and harmless. The last tab and the pinned checks live in `localStorage` per
device, and the pins of the turn card on the character.

## Validation evidence

- Client tests in `apps/client/src/sheet/`: the frame and tabs, the HP drawer, the GM-only controls, Hit Point Dice
  per die and the Level box (`sheet-frame.test.tsx`); the turn card, its fill and its pins, the mastery label and the
  laptop list (`turn-card.test.tsx`, `favourites.test.tsx`, `item-actions.test.tsx`); the cast card and slot choice
  (`cast-targets.test.tsx`, `spells-tab.test.tsx`); the spellbook and the prepare step (`spellbook.test.tsx`); gear
  (`gear-tab.test.tsx`); uses (`uses.test.tsx`). The old sheet's behaviour tests moved here with new queries.
- Server tests: `sheet-turn-options.test.ts` (mastery labels and list, reasons, the passive flags, a sentence for
  every rule id), `next-level.test.ts` (lines for one class, a subclass level, per-level Hit Point riders and
  multiclass; who may ask; the refusals), `favourites.test.ts` (the command's authorization and validation, counting
  on resolve, use and reaction, the bounded map, and the projection proofs) and `builder-roll-abilities.test.ts` (the
  builder purpose).
- Smoke journeys in `e2e/journeys.spec.ts`: a claim opens the sheet with Release in its menu. A player on a phone
  opens Guiding Bolt from the turn card, casts it at level 1 from the cast card, picks a target and rolls.
- Screenshots of the nine moments on the six screens at 390 by 844 with touch and at 1280 by 800, compared with the
  mockups.

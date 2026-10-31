# ADR-0047: The Ledger character sheet

## Status

Accepted

## Context and decision drivers

The owner disliked the character sheet on every surface it appears: the Sheet page, the Table panel, the GM's dialog and
the phone. The arcade cabinet redesign (ADR-0037) and Horizon light (ADR-0046) had changed its look but kept the
remaster's arrangement (ADR-0030): a band of equal stat boxes, hit points shown in two styles, a Play tab that overlapped
Actions, seven tabs on a phone, and tab strips nested three deep in the Table panel.

The owner chose the replacement over four rounds of mockups, kept in `docs/design/polish/D1-character-sheet/history/`,
judged on three things: a player who has used another VTT recognises it, it is easy to get around, and it is neither
noisy nor mismatched.

What the decision had to keep:

- Every behaviour of the sheet: rolls, hit points, rests, slots, uses, conditions, casting and attacking, in and out of
  an encounter. The server decides all of it, and no projection changes.
- Phones stay first-class, and the 44 px touch target stays the rule.
- The Light rail / Horizon language: one primary, the horizon on the app bar and under the chosen tab, and colours that
  mean something.

## Considered options

- Round 1: Classic, Cockpit and Scroll.
- Round 2, taking Cockpit further: Console, Hotbar, Lanes and Focus.
- Round 3, familiar VTT sheets: Beyond (D&D Beyond), Foundry and Paper (the printed sheet, as Roll20 follows it).
- Round 4, Beyond made OzyVTT's own: Strip, Grouped (skills under their ability, as on the 2024 sheet) and Ledger.

## Decision

1. A vitals band runs across the top of the sheet on every screen: identity and condition chips, then one plate with
   AC, hit points (number, life bar, Damage, Heal and Temp), initiative, speed, proficiency and Heroic Inspiration, then
   Rest with the Hit Point Dice. Phones pin a compact band with the same cells in the same order.
2. On a laptop, three columns: abilities as rows with score, check and saving throw, and Senses under them; skills; one
   tabbed box with Actions, Spells, Gear, Features and Notes. Below 1280 px the first two stack in one column.
3. On a phone and in the Table panel: the band and one tab strip pinned, with Main, Actions, Spells, Gear, Features and
   Notes. Main holds the laptop's first two columns.
4. One row of tabs. The Play and Checks tabs and the Actions subtabs are retired; their parts move as the handoff plan
   lists.
5. A number you roll is its own button, with no box drawn around it. Action and spell rows stay whole-row buttons, with
   range, hit or DC and damage in columns.
6. On a laptop with a mouse, skill rows use `--row-h-dense` (30 px) so all eighteen fit at 1280 by 800. Any coarse
   pointer restores 44 px. This is the one exception to the 44 px rule outside GM data regions.

## Consequences and tradeoffs

- Familiar and quieter: one band, one plate style and one row of tabs. Checks never need a tab on a laptop.
- The tabbed box shares the width with two columns, so long tables scroll inside it.
- Dense skill rows trade the touch target for fit, only where no touch input is present.
- Pinned checks move into the Skills card; Food and water moves to Gear; GM tools become a GM tab on every frame.
- Its boxes and secondary controls follow the theme spec (ADR-0048): Cradle boxes for the groups you act in, an open
  group for Senses, and Base line controls.

## Mobile, security, and visibility impact

- Phones keep 44 px rows, fields at 16 px and no sideways scroll; the band and tabs are pinned and the body scrolls.
- No data, command or projection changes. The sheet shows exactly what it showed, in new places.

## Migration / reversibility

- Client only. A stored tab of "play" or "checks" reads as Main on a phone and Actions on a laptop.
- Reversible by reverting the client commits; no stored data changes shape.

## Validation evidence

- The approved mockup: `docs/design/polish/D1-character-sheet/ledger-sheet.html`.
- The plan's verification (section 6 of its PLAN.md) at 1280 by 800, 1100 by 800, 390 by 844 and the 392 px Table
  panel, in Dusk and Dawn, with reduced motion and reduced transparency, plus the full checks and smoke suite.

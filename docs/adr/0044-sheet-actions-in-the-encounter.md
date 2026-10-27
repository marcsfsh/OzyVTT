# ADR-0044: The sheet's Actions tab, resolved in the encounter

## Status

Accepted on 2026-10-27, with the owner's choice: by default the player picks the target.

## Context and decision drivers

A player wants to open their sheet, tap "+8" beside their Longsword and have the attack happen in the running
encounter. Part of that exists: a cast or attack from the sheet goes to targeting on the character's turn. But the
sheet spreads what a character can do across Play, Spells, Gear and Features, and the GM has no way to keep target
choice to themselves. The owner pointed to D&D Beyond's Actions tab: one place with All, Attack, Action, Bonus
Action, Reaction and Other.

Drivers: the server decides (the sheet sends the same commands the table does, and the server checks the turn, the
cost and the target); one place for everything a character can do; a GM setting for who picks targets; phones
first-class.

## Considered options

1. Keep the tabs and add filters to Play. Rejected: the owner wants the Actions tab by name, beside the others.
2. An Actions tab with subtabs, listing every usable thing once by its cost. Chosen.

## Decision

- **The tab.** The sheet gains **Actions** beside Checks, Spells, Gear, Features and Notes. Its subtabs are All,
  Attack, Action, Bonus Action, Reaction, Other and Saving throws. Each row is a thing the character can do now: an
  attack from an equipped weapon or an unarmed strike, a prepared spell or cantrip, a feature with a use, an item's
  activation. It sits under the subtab of its cost (an attack also under Attack); All lists every row once.
  Saving throws lists the six saves.
- **Resolving.** With an encounter in progress, a row sends the same command the table's acting card sends, so it
  resolves in that encounter: the server checks it is the character's turn (or a reaction it may take) and what it
  costs. Out of an encounter, a row rolls as the sheet does today. A saving throw row answers a pending save for that
  character when one waits, and is a free save roll otherwise.
- **Who picks the target.** A new table setting, `targeting: "player" | "gm"`, default `player`, in Settings >
  Fights. With `player`, tapping a row opens targeting on the map before the roll. With `gm`, the command is sent
  without a target and waits in the GM's Needs you ("Lyra attacks with her Longsword: choose a target"); the GM picks
  and it resolves. A row that needs no target resolves at once either way.
- **Seen by others.** The setting is a table rule players may read; nothing about another character crosses.
- **Storage.** One optional field on the table's rules policy, read with a default; no SQL migration.

## Consequences and tradeoffs

- Everything a character can do is in one place, ordered by what it costs.
- With the GM picking targets, a player's attack waits on the GM; that is the setting's purpose.

## Mobile, security, and visibility impact

The command path and its checks are the table's own; nothing new is trusted from the sheet. Subtabs scroll sideways
at 390px with full labels, and each row is at least 44px.

## Migration / reversibility

Additive; every table starts with the player picking targets, today's behavior.

## Validation evidence

To be added with the code: each subtab's rows for a sample character, a row resolving in the encounter, the turn
check refusing off-turn use, both targeting settings end to end, the save row answering a pending save, and the
sheet at phone and laptop widths.

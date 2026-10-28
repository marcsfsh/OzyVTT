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
  Encounters. With `player`, tapping a row opens targeting on the map before the roll. With `gm`, the command is sent
  without a target and waits in the GM's Needs you ("Lyra uses Longsword · choose a target"); the GM picks
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

## As built

- **The tab.** Actions sits beside Play, so a phone's bar has seven tabs. Play keeps the character's state (the
  phone's Vitals, rests, pinned checks, slots and uses), in an encounter too; a sheet opens on Actions when an
  encounter starts and on Play when it ends or the character goes down. The table panel hides Actions in an encounter
  as it hides Play, since its Turn tab lists the same options. Attack lists anything with an attack roll, a spell's
  too. The generic actions (Dash, Dodge, Grapple) show under All and Action. A phone's All keeps the turn card with
  its favourite tiles; the other subtabs are lists.
- **Outside an encounter.** A row goes to the server's loose route, as the Gear and Spells tabs do: an attack rolls
  with its damage, a heal or a cast at creatures asks whom first.
- **Saving throws.** A save the character owes takes its ability's row, as the same prompt the table shows, so the
  tap answers it; the other five roll freely.
- **The GM picks.** `GameState.targeting` (`table.set-targeting`), a field of its own beside `playerDice` rather than
  on the rules policy, with a schema default and no migration. A player's tap that would aim sends
  `action.ask-target` with how they chose to cast it (slot level, darts, Metamagic); the server checks the turn and the
  action and holds one ask per character in `combat.targetAsks`. The player sees their own ask with Take back. The GM's
  Needs you card opens the GM's own targeting for that character at that slot, and the GM resolves it as any of their
  resolves, with their own dice. The GM's committed resolve for the character, Take back, Turn down, the turn ending or
  the setting going back to the player clears it. `action.resolve` refuses a player's own targets or area at a `gm`
  table in an encounter, aiming at themself (a potion they drink) aside.

## Validation evidence

- `target-asks.test.ts` (server, over HTTP): the setting starts at `player` and is the GM's to change; at `gm` the
  player's own aim is refused, the ask holds and is projected to its player as id, action and name only, a second ask
  is refused, the GM's look at the attack leaves it and the GM's confirm answers it; Take back and the turn ending
  clear it; an ask off the turn or for an action the character lacks is refused.
- `actions-tab.test.tsx`: the subtabs in order, an attack under Attack, a Bonus Action under its own and not there, an
  empty subtab's line; an attack outside an encounter rolling with its damage; a save owed in its ability's row and
  the other five rolling; the sheet opening on Actions in an encounter, where a tap aims, and asking the GM where the
  GM picks, with the waiting ask's Take back.
- `needs-you.test.tsx`: the ask's card names the action and its slot, opens the GM's aim at that slot, and Turn down
  withdraws it. `table-settings.test.tsx`: the Settings row and its command.
- Screenshots (Dusk) of a player's sheet in an encounter at 390px and 1280px: the seven sheet tabs fit the phone's
  width, the subtabs scroll sideways with full labels and a fade at the cut edge, and Actions opens with the turn card
  off the character's turn. Settings > Encounters shows Who picks targets at 390px. The smoke suite passes.

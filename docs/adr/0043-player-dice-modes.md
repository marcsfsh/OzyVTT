# ADR-0043: How players' dice are entered

## Status

Accepted on 2026-10-27, with the owner's choices: separate settings for d20 rolls and for damage, a table default in
Settings with an encounter's own choice in its settings, and the GM always typing totals for characters played at
the table.

## Context and decision drivers

Tables differ in who rolls. Some roll physical dice and report the total, some report the face and want the app to
add the bonus, some let the app roll. Today one switch, `builderPolicy.typedRolls` (`open` or `gm-only`), lets a
player type a d20 face or not, and damage has no player choice at all: a spell that deals damage on a failed save is
rolled by the server when it resolves.

Drivers: the server stays the authority (it validates every typed number and adds every bonus it is asked to); one
plain choice per kind of roll; a quick change for one encounter; nothing a player types is trusted for anything but
the number it reports.

## Considered options

1. Keep `typedRolls` and add a damage switch. Rejected: "enter the total" isn't expressible, and two shapes of
   setting for one idea confuse.
2. Three modes, set apart for d20 rolls and for damage, with an encounter override. Chosen.

## Decision

- **Modes.** Each is one of:
  - `total`: the player types the final number, bonuses included. The server records it as typed and checks it
    against the formula's possible range (a d20 + 5 total must be 6 to 25).
  - `die`: the player types the face of each die; the server adds every modifier the rules give, as it does for a
    typed natural d20 today.
  - `app`: the server rolls.
- **Two settings.** `playerDice.d20` covers attacks, checks, saves, initiative and death saves; `playerDice.damage`
  covers damage and healing dice, including the damage a character's effect deals when its targets save ("save or
  take damage", "half on a save"). In `total` or `die` the damage waits for the player's number before it applies,
  under the same prompt the GM's damage uses today.
- **Where it is set.** Settings > Fights holds the table default. An encounter's settings (beside ADR-0039's
  initiative choices) can say "Use the table's" or pick its own, and Start the encounter shows what applies.
- **Played at the table.** A character played at the table (ADR-0042) gets the GM's box in `total` mode, whatever the
  settings say.
- **The GM.** The GM may always type or roll, as today.
- **Migration.** `typedRolls: "open"` becomes `d20: "die"`, `typedRolls: "gm-only"` becomes `d20: "app"`; damage
  starts at `app`, today's behavior. A new numbered migration in the game store moves the stored policy;
  `typedRolls` leaves the API, replaced by `playerDice`.
- **Seen by others.** A typed roll is marked `typed` as now; the mode itself is a table setting players may read.

## Consequences and tradeoffs

- One clear choice per kind of roll, and a table can run physical dice for damage while the app rolls attacks.
- A typed total can't be checked beyond its range; that is the trade a table makes when it rolls its own dice.

## Mobile, security, and visibility impact

Every typed number is validated on the server; no bonus or rule result is taken from the client. The entry box is a
44px numeric field at 390px.

## Migration / reversibility

The numbered migration maps the old setting exactly, so a table's behavior is unchanged until the GM picks a new mode.

## As built

- **d20 rolls.** `rolledTotal` (and `attackRolledTotal`) on `save.answer`, `save.roll`, `death-save.roll`, `check.roll`,
  `roll-call.answer`, `initiative.roll-self`, `action.resolve` and a reaction's strike. The server takes off the bonus
  it works out and uses the face that leaves, so a typed total is checked and recorded as typed, and a natural 20 or 1
  is still known. "The bonus" is every fixed modifier; dice an effect adds (Bless's d4, a Bardic Inspiration die) the
  server still throws in both typed modes, and the box says the bonus is included. A Heroic Inspiration reroll of a
  typed die takes the rerolled face.
- **The player's box.** A player has no device choice: `app` rolls, `die` asks for the face (with a Roll button still
  there), `total` asks for the total. The GM keeps the device choice, except for a character played at the table, whose
  prompts ask the GM for the total.
- **Builder.** Typed rolled scores and hit points follow `d20`: allowed unless it is `app`.
- **Where it is set.** Settings > Encounters has both modes; an encounter's Encounter settings can use the table's or
  pick its own (`encounter.set-player-dice`); Start the encounter says what applies.

## Validation evidence

To be added with the code: each mode for each kind of roll on both transports, the range check, a save-for-damage
effect waiting for the player's number, the encounter override, the at-the-table rule, and the migration test.

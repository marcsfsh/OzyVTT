# ADR-0052: Arrival: the logo in the sky, signing in in place, the party as a lineup and the empty table as a lobby

## Status

Accepted

## Context and decision drivers

Area B of the polish pass (`docs/design/polish/B-arrival/`) is how a person gets into the right seat. Running the
branch at `f5e166f` showed:

- The title screen's wordmark sits on the sun, so the neon script vtt is hard to read against it.
- The GM's sign-in card replaces the two buttons over the scene, and first run uses the same card.
- A player with no character sees the sunset at the left, with the wordmark over the sun again, and a panel of rows
  with checkboxes at the right.
- The join address shows in four places in three looks: the empty table, the roster, Settings and the phone strip's
  Join sheet.

The owner turned down round 1 whole ("VTT is impossible to read in front of the sun; the logo needs to be separated")
and chose from round 2, six options for each question. Both rounds are kept in `docs/design/polish/B-arrival/history/`.

## Considered options

- Title screen: Sky (the logo in the sky above a smaller sun), Marquee (the logo on a sign across the top), Ground (the
  logo on the floor), Beside (a poster with the logo at the left), Corner (a small logo at the top left), After sunset
  (a sliver of sun and the logo above its glow).
- GM sign-in: In place (a card where the buttons were), Console (a terminal look), Own page (the scene as a band),
  Beside (a panel at the right), Drop-down (under the GM button), Horizon strip (one band along the horizon).
- Picking a character: Panel (today's), Lineup (tall cards before the sunset), Roll call (rows with their own Play
  buttons), In the app (the roster's bands, no scene), Preview (a list and the chosen character large), Seats (around a
  table).
- Inviting players: Lobby (the empty table), Who is here (in the menu), Address chip (in the bar), Table screen (on the
  TV), Banner (under the bar), Join card (printed).

## Decision

1. The title screen keeps today's scene with a smaller sun and the logo in clear sky above it, and the two buttons on
   the grid below the horizon.
2. The GM signs in, and sets the password on first run, on a card that takes the buttons' place, while the scene eases
   up to make room.
3. A player picks from the party standing before the sunset as tall cards; with a map live the same cards sit in the
   table's panel.
4. While no map is live, the GM's empty table is a lobby: the join code and address, and the party filling in as
   characters are claimed. Its join block is the one look for the address everywhere else.
5. Eleven rules for arrival, listed in `docs/design/polish/B-arrival/SPEC.md` section 3.

## Consequences and tradeoffs

- The logo reads in both themes, and it shows only on the title screen and while signing in; inside the app the bar
  carries it.
- The lobby tells the GM who has arrived before the game starts, using what the GM's view already holds.
- The join address has one look and three places, and the roster and the phone strip stop repeating it.

## Mobile, security, and visibility impact

- Every control keeps a 44 px hit area. The lineup scrolls sideways on a phone; the sign-in card and the foot fit 390 px.
- No data, command or projection changes. The lobby reads the claim state and played at the table flag the GM's view
  already holds; the pick page shows only the characters and fields the player's projection lists.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/B-arrival/arrival.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, signed out, as the GM and as a player, plus the full
  checks and the smoke suite.

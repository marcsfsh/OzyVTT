# ADR-0040: The table screen's latest roll

## Status

Proposed. Needs the owner's sign-off before any server code.

## Context and decision drivers

ADR-0037 draws a latest-roll card in the table screen's column: who rolled, what for, the total with its dice, and an
outcome. The screen's feed (`viewer-presentation.ts`, `viewer-encounter.ts`, sent by `viewer-coordinator.ts`) carries
no rolls today, so phase 7 reserves the card with "Roll display is not available yet." The screen is a public
audience in a room: anything on it is seen by everyone at the table, and it holds a paired viewer cookie, never a GM
credential or a player session (ADR-0028).

Drivers: build the card on the server from an explicit allow-list; nothing about a hidden creature, a private roll or
a GM-only line; clear a card that no longer belongs to what the screen shows; keep the GM's preview and the screen
identical; keep pairing and revocation as they are; no stored data when a derived field will do.

## Considered options

1. Send the screen the public rows of the combat log. Rejected: narration rows name targets and outcomes written for
   players' devices, and the screen would inherit every future row kind.
2. A derived card built from the latest qualifying roll at feed time. Chosen.
3. Let the GM push a roll to the screen by hand. Rejected: one more task during a fight, and the drawing shows the
   card following play.

## Decision

These are the choices to confirm.

- **Field.** The feed gains `latestRoll: ViewerRollCard | null`, built in the coordinator from `GameState.rolls` and
  the screen's audience at send time. `ViewerRollCard` holds only: `id` (an opaque id for the card, not the roll's),
  `who` (the roller's label: "GM", or the character name recorded at roll time), `what` (the roll's label, else its
  purpose in words), `total`, `dice` (sides, face and kept for each die) and `modifier` (one signed number).
- **What counts as public.** A roll qualifies only when all of these hold: its visibility is `public` (never
  `gm-only`, `blind` or `self-only`); its purpose is not `builder`; and its actor, when it has one, is a creature the
  screen's audience can see now (`hiddenFrom` in `vision/audience.ts`, so fog and dynamic vision count, not
  `visibility === "gm-only"` alone). A GM roll with no actor qualifies when public.
- **Targets, saves and outcomes.** Left out of this version. Hit or miss, damage taken and "is bloodied" come from
  attack resolution and name a target; they need their own allow-list (a target the screen can see, a band never an
  exact number) and are a later amendment. Annotations, conditions and rules notes never ride on the card.
- **Staleness.** The card shows the latest qualifying roll made since the screen last changed what it shows. The
  marker moves on `viewer.presentation.begin`, `viewer.map.set`, a change of live scene, and the start or end of a
  fight; a roll older than the marker never appears. A card also clears 10 minutes after its roll. The marker is an
  optional field of the stored presentation, so a restart keeps it; no SQL migration.
- **Hidden creatures later.** The card is rebuilt on every send, so a roll by a creature that becomes hidden drops
  out at the next send instead of lingering.
- **Preview parity.** The GM's preview loads the same `/viewer.html` over the same feed, so it shows the same card.
- **Revocation.** Unchanged: a revoked screen gets 401 and stops; the card adds no credential or session to the feed.
- **Client.** The column's reserved card shows `latestRoll` when present and keeps its notice text when null.

## Consequences and tradeoffs

- The room sees the dice as they land, with no step for the GM.
- Without outcomes, the card says what was rolled, not what it did, until the amendment.
- The rule for an actor is stricter than the players' feed, which shows a public roll whatever its actor: the screen
  may hold a creature's position in a way a player's log line doesn't.

## Mobile, security, and visibility impact

- The card is built from an allow-list on the server; a projection test checks each excluded case (each private
  visibility, a builder roll, a hidden actor under fog and by visibility, a roll older than the marker).
- No phone surface changes.

## Migration / reversibility

The field is derived and the marker optional; removing the feature drops both with no data to undo.

## Validation evidence

To be added with the code: the projection tests above, the marker moving on each listed change, the 10 minute expiry,
preview and screen receiving the same feed, a revoked screen still refused, and the column rendering the card and
the empty notice.

# ADR-0038: Table chat

## Status

Proposed. Needs the owner's sign-off before any server code.

## Context and decision drivers

ADR-0037 draws one composer under the table's log: quick dice, a field, and lines of chat between the rolls. Today
the field only rolls (`table/LogComposer.tsx` sends `dice:roll`), and the log holds narration and rolls alone. The
feed already has what chat needs: the combat log store (`apps/server/src/combat-log.ts`) keeps the newest 2,000 rows,
`projectFeedRow` decides per reader what a row shows, `log:entry` is projected per socket, and `log:read` backfills
up to 1,000 rows after a reconnect.

Drivers: the server decides (attribution comes from the signed token, never from the client); players act only as
their own character; the log stays one ordered feed; a mistyped roll is never broadcast as chat; plain text with no
way to inject markup; phones first-class; no new store when the existing one fits.

## Considered options

1. A chat store and channel of its own. Rejected: two orders to merge on every device, two backfills after a
   reconnect, and a second retention rule, for lines the drawing shows in one feed.
2. Chat rows in the combat log, with a command of their own. Chosen.
3. Chat through `dice:roll` with a text-only mode. Rejected: dice and words have different authorization, limits
   and deletion, and a malformed formula would be one branch away from becoming chat.

## Decision

These are the choices to confirm.

- **Audience.** Every chat line is public to the GM and every player session. No whispers, no GM-only chat and no
  line for one character in this version. The table screen never shows chat: the viewer feed is unchanged.
- **Command.** A new game command `chat:send` with `{ commandId, text, actorId? }`, defined the shared way (domain
  schema, typed socket event, a `GAME_COMMANDS` entry, a `defineCommand` handler), with the same integration scope
  as `dice:roll`. The `commandId` makes a resend idempotent through the existing receipts.
- **Attribution.** The server stamps the author from the token. A player's line is their character's: `actorId`
  must be a character their session has claimed, and is required when they hold more than one. A session with no
  claimed character can't send. The GM's lines read "GM". The stored row keeps the author's name as it was when
  sent, the actor id and the sending session; the session id never leaves the server.
- **Text.** Trimmed, normalized to NFC, control characters removed and line breaks folded to spaces; 1 to 500
  characters, counted in code points after that. Clients render it as a text node: no Markdown, no autolinks, no
  HTML anywhere. A line that starts with `/` is refused by the server, so a client that fails to route a command
  never broadcasts it.
- **Roll intent.** The composer decides before it sends. `/roll <formula>` or `/r <formula>`, a quick die, and the
  Roll the formula button send `dice:roll`; a malformed formula is refused there with the dice error, and nothing is
  broadcast. Any other `/` word is refused on the client as an unknown command. Everything else is `chat:send`.
- **Ordering.** Server insertion order, as every feed row; `at` is the server's clock.
- **Backfill.** Unchanged: `log:read` with a limit, deduplicated by feed id on the client. Paging older history
  stays out of this version (a player's feed ids carry no order by design, so a cursor would need its own design).
- **Deletion.** An author may delete their own line and the GM may delete any. A delete removes the row; a new
  projected event `log:removed` carries the id each reader knows it by. Nothing of a deleted line is kept.
- **Rate limit.** Per session, 5 lines in 10 seconds and 30 in a minute, refused with a plain message. The GM gets
  twice that.
- **Retention.** Chat rows share the feed's 2,000-row cap with narration and rolls.
- **Storage.** Rows of `kind: "chat"` in `combat_log`, using the columns it has: `text`, `actor_id`,
  `initiator_session_id`, and `payload_json` for the author's name. No SQL migration is expected; if review finds a
  column is needed, it is migration 2 in `combat-log.ts`.
- **Projection.** `CombatLogEntry` gains `kind: "chat"` and `author: { name, role, actorId? }`. `projectFeedRow`
  passes chat rows to every reader. A projection test pins that no session id, visibility or other reader's data
  reaches a player.

## Consequences and tradeoffs

- One feed keeps rolls and words in the order they happened, and the existing backfill and dedupe cover chat.
- Busy chat pushes old narration out of the 2,000-row window sooner.
- No whispers: a private word stays a conversation away from the table, which matches a home group in one room.

## Mobile, security, and visibility impact

- Public only, so nothing in a chat line is new information to any audience that can read it. The table screen is
  untouched.
- Attribution and authorization come from the token; a player can't speak as another character or as the GM.
- Text is rendered as text on every client; the server never builds HTML from it.
- The composer is the drawn one at 390px: the field, Send, and the quick dice.

## Migration / reversibility

No change to stored data is expected. Turning chat off later leaves rows of an unknown kind, which the client skips.

## Validation evidence

To be added with the code: both transports for `chat:send` and the delete, the attribution and claim checks, the
rate limit, refusal of `/` lines, the length rules, `projectFeedRow` for chat, a reconnect backfill, and the
composer's routing of `/roll` and of a malformed formula.

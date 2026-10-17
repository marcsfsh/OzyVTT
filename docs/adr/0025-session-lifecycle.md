# ADR-0025: The session lifecycle and one answer per credential

## Status

Accepted, 2026-10-17. Amends ADR-0011 (identity) and point 5 of ADR-0016 (status codes).

## Context and decision drivers

A first-evening walkthrough found three problems with how a session starts, lasts and ends:

- **The answers disagreed.** The same credential got different status codes on different routes. A garbage or
  revoked token was a 403 on the game, Codex and integration routes and a 401 on the maps, sounds and viewer
  routes; a valid player session was a 401 on the map, token and sound management routes and the host's GM routes;
  map content answered 403 with no token at all. A client could not tell "sign in again" from "you may not".
- **A GM tab never heard that its session ended.** Revoking GM sessions disconnected the socket without a reason,
  and the client showed "Reconnecting to the table…" forever while it kept working on stale state. A socket that
  joined with a dead token was quietly given a new player seat.
- **A reload signed the GM out.** The GM token lived in memory only, so a reload or a second tab went back to the
  title screen.

The rules that bound the fix: role comes from the signed credential and is re-checked per command (ADR-0011); the
host's GM routes stay same-origin (ADR-0016); nothing about who may do what moves to the client.

## Considered options

- **Keep ADR-0016's rule (403 for every presented credential that failed).** It avoids telling a caller whether its
  token was ever valid, but a dead token is not a secret worth hiding on a LAN: the caller holds it. It also leaves
  a client unable to act: a revoked GM and a player on a GM route got the same answer.
- **One helper, two answers (chosen).** 401 when the caller has to sign in, 403 when signing in again would not help.
- **Keep the GM token in localStorage always.** Survives everything, but a shared family laptop would stay signed in
  as the GM for 12 hours after the game.
- **sessionStorage by default, localStorage on request (chosen),** with open tabs sharing the session.

## Decision

**One rule, one helper.** `apps/server/src/request-auth.ts` reads the caller from the request's credential: a GM
session, a player session, a GM-minted integration credential, or a paired table screen's viewer credential (from a
bearer header, which wins, or the viewer cookie where a route accepts it). Every HTTP router and the socket handshake
use it. The answer is:

- **401 `unauthenticated`**: no credential, or one that is malformed, expired or revoked.
- **403 `forbidden`**: a valid credential whose role or scope does not reach the route.

Integration credentials needed one change for this: `IntegrationCredentialStore.check` tells a dead credential (null)
from a live one without the scope (`inScope: false`). The command tunnel checks that a credential is live before it
reads the envelope, so a dead token hears 401 even with a malformed body.

`apps/server/test/credential-walk.test.ts` walks every route Express has mounted under `/api/v1` with four
credentials (none, garbage, a revoked GM session, a player session) and pins every answer in
`test/__snapshots__/credential-answers.txt`. It also checks that each refusal a route gives is declared in its OpenAPI
operation. A new route shows up in that file, so it is reviewed.

What changed, route by route (player = a valid player session; dead = garbage, expired or revoked):

| Routes                                                                 | Before                                | Now                     |
| ---------------------------------------------------------------------- | ------------------------------------- | ----------------------- |
| `/game/*`, `/content/*`, `/encounters/*`, `/sessions/*` (typed routes) | dead 403                              | dead 401                |
| `POST /game/commands`                                                  | no token with a bad envelope 400      | 401                     |
| `/codex/*` reads, writes and the import guard                          | dead 403                              | dead 401                |
| `GET /codex-assets/{id}/content`                                       | none 403, dead 403                    | none and dead 401       |
| `/map-assets` management                                               | player 401                            | player 403              |
| `/map-assets/{id}/content` and `/grid`                                 | none 403, dead 403                    | none and dead 401       |
| `/token-assets` management                                             | player 401                            | player 403              |
| `/token-assets/{id}/content`                                           | none 403, dead 403                    | none and dead 401       |
| `/sound-assets` management                                             | player 401                            | player 403              |
| `/sound-assets/{id}/content`                                           | none 403, dead 403                    | none and dead 401       |
| `/homebrew/*`                                                          | unchanged (already 401 and 403)       | the helper answers it   |
| `/viewer/*` GM routes                                                  | player 401                            | player 403              |
| `POST /viewer/sound-status`                                            | GM or player 401                      | 403                     |
| `/system/capabilities`                                                 | dead 403                              | dead 401                |
| `/gm/integration-credentials*`                                         | player and integration credential 401 | 403                     |
| `/host/gm/sign-out`, `revoke-all`, `viewer-urls`                       | player 401                            | player 403              |
| Socket `session:join` with a dead token                                | a new player seat                     | `code: unauthenticated` |
| Socket command after the session ended                                 | "Join a session first."               | `session:ended`, drop   |

Every guarantee of ADR-0011 and ADR-0016 holds: role still comes from the signed credential and is checked per
command; an integration credential still never reaches the host's GM routes or mints a player; a hidden record is
still a 404; asset content is still refused before any lookup, so its answer never depends on whether the file
exists. The only change for an asset route is that "no credential" now says so.

**A session that ends is told.** A socket whose token stops verifying (sign-out, revoke-all, a password change, the
12-hour expiry) gets `session:ended` and is disconnected. `broadcast()` checks every socket as it already did, and a
30-second sweep catches a session that ran out with nothing else happening. A command from such a socket answers
`unauthenticated`. The client's `onSessionEnded` hook hears the same from any HTTP 401 for its own token, and ignores
one for a token it has already replaced.

**The GM tab stays signed in.** The client keeps the GM token in sessionStorage (a reload resumes) and, when "Keep me
signed in on this computer" is on, in localStorage until the token's own expiry. A new tab with neither asks the open
tabs over a `BroadcastChannel` (same browser, same origin) and joins with the answer. The server still decides: a
resumed token is joined like any other, and a refused one is forgotten. When a GM session ends the tab goes back to
the sign-in with "Your GM session ended. Sign in again."; a player's tab goes back to the landing, and its next join
drops the dead token and takes a fresh seat.

**The GM password.** `POST /host/gm/password` changes it after checking the current one, counted with sign-in attempts
against the rate limit. It ends every GM session issued before the change and returns a new token for the caller, who
moves its socket to it; the other GM devices are told after a 5-second grace. Resetting a forgotten password is still
done on the host: stop OzyVTT, delete `data/auth.json`, start it and set a new one. A new password brings a new token
secret, so every older session is dead; setting it therefore lets go of every claim, and players claim again.

## Consequences and tradeoffs

A client can act on a status: 401 means sign in again, 403 means show the reason. A caller learns that a token it
holds is dead, which on a home LAN gives nothing away. A GM who ticks "Keep me signed in" on a shared computer stays
signed in for up to 12 hours; the box is off by default and Sign out ends it. The sweep adds one HMAC check per socket
every 30 seconds.

## Mobile, security, and visibility impact

No projection changed. A player's phone that held a seat from before a password reset joins again with a fresh one;
the character it held is released by the reset. The BroadcastChannel reply carries the GM token only to tabs of the
same origin in the same browser profile, which could already read the GM's sessionStorage through any open GM tab.

## Migration / reversibility

Integrations that branched on 403 for a revoked credential now see 401; both carry the stable `error.code`. The
pinned answer file makes any later change to the rule visible.

## Validation evidence

`credential-walk.test.ts` (every mounted route, four credentials, plus the socket handshake and the sweep),
`request-auth.test.ts`, `host-account.test.ts`, and the updated router tests. The smoke suite's first-evening journey
reloads the GM page and stays signed in.

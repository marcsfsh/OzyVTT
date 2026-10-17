# ADR-0026: Pairing a table screen from the code it shows

## Status

Accepted, 2026-10-17.

## Context and decision drivers

The table screen (a TV, usually) pairs once and then shows the player-safe presentation and plays the table's sound. Until
now the GM created a 12-character code on their device and someone typed it into the TV. On a TV that means a remote,
an on-screen keyboard and twelve characters, which the first-evening walkthrough found to be the slowest step of the
night.

What pairing must keep:

- The screen ends up with the same viewer credential as before: an HttpOnly, SameSite=Strict cookie holding a
  random token, stored server-side only as a hash, revocable from the GM's list of screens. Nothing downstream
  changes.
- Only the GM decides which device becomes a table screen.
- The codes are short-lived, single-use and rate-limited.

## Considered options

- **Keep the GM's code, shorter.** Still typed on the TV, only less of it.
- **A QR code on the GM's device that the TV scans.** TVs have no camera.
- **The screen shows a code, the GM types it on their own device (chosen).** The GM is at a laptop or phone with a
  real keyboard; the TV only has to display.

## Decision

`POST /api/v1/viewer/screen-pairings` (no credential) opens a request: the server makes a 32-byte random secret, which
goes to the screen in an HttpOnly, SameSite=Strict `vtt_viewer_pairing` cookie scoped to the screen-pairing routes,
and a six-digit code, which the screen shows. The server keeps the secret's hash, the code and an expiry in memory.

The screen polls `GET /api/v1/viewer/screen-pairings/current` every two seconds with its cookie. The answer is
`waiting` with its code, or 404 once the request has run out, when the screen opens a new one.

The GM types the code under Shared screen. `POST /api/v1/viewer/screen-pairings/approve` (GM session only) finds the
open request showing that code and marks it approved with the screen's name. On the screen's next poll the server
mints the viewer credential through the same code path as the old exchange, sets the `vtt_viewer_session` cookie,
clears the pairing cookie and deletes the request.

The old flow (`POST /viewer/pairings` and `/exchange`) stays in the API for scripts; the app no longer offers it.

Limits (`viewer-access.ts`): a code lasts 10 minutes; at most 20 requests are open at once and 30 may be opened per
minute (429 beyond either); open codes are unique; a wrong code at approval counts toward the existing limit of 20
failures a minute (429). A code that names no open request is a 404, never a 401, so a typo never signs the GM out.

## Security reasoning

- **The code is a name, never a key.** Holding the code collects nothing: the credential goes only to the holder of
  the request's secret, which never leaves the screen's cookie jar and is never shown. Someone who reads the code off
  the TV across the room can do nothing with it.
- **Only a GM session approves.** An attacker on the LAN can open requests but cannot approve one, so they cannot
  turn a device of theirs into a table screen. The approval route is GM-session only (an integration credential gets
  403, ADR-0025).
- **The GM approves only the code in front of them.** Codes are unique among open requests, so the code a GM types
  names one request. An attacker's own request has a different code. With at most 20 open, a mistyped six-digit code
  lands on another open request about once in 50,000 tries, and even then the GM sees which screen paired and can
  revoke it.
- **Flooding is bounded.** Open requests are capped and rate-limited, and each is a few bytes of memory that expires.
  A flood can stop a new screen from getting a code for a minute; it cannot pair anything.
- **Single use.** The request is deleted when its credential is minted. A replayed poll gets 404.
- **The credential is unchanged.** Same token format, same hash at rest, same revocation, same player-safe
  presentation projection. A paired screen still reads only what the GM presents.
- **What a screen sees while unpaired.** Only its own code and expiry. A request reveals nothing about others.

## Consequences and tradeoffs

Pairing needs no typing on the TV. The screen polls while unpaired (one small request every two seconds); a paired
screen does not poll. Requests live in memory, so a server restart drops open codes and the screen opens a new one on
its next poll.

## Mobile, security, and visibility impact

The GM types the code on a phone as easily as on a laptop (a numeric field). The screen-pairing view is readable
across a room at 1080p and works on a tablet or phone used as a screen.

## Migration / reversibility

Paired screens keep working: the credential is unchanged. Removing this flow would leave the old exchange in place.

## Validation evidence

`viewer-access.test.ts` (pairing once, expiry, unique codes, the caps and the wrong-code limit) and `viewer-http.test.ts`
(the cookies, the GM's approval, the 404 for a wrong code, single use). The smoke suite's first-evening journey pairs a
screen this way at both viewports.

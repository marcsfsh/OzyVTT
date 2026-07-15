# Phase 1 starter roster and character claims

## Outcome

The app now opens with three deterministic placeholder player characters so the accountless join flow can be exercised before JSON import exists. A one-time application seed adds the roster to a new database and to an existing empty pre-seed database without duplicating it on restart.

Players see each public character as **Available**, **Your character**, or **Claimed**. Player projections omit the owning session ID and GM-only notes. The GM sees current claim occupancy without receiving player claim controls yet.

## MVP policy

One player session may claim one character. Claim commands are serialized by the authoritative store, carry an expected revision and unique command ID, and reject a character already owned by another session. A player must release their current character before claiming another.

The browser retains its signed player session token, while actor ownership is stored in SQLite. Releasing clears every actor owned by that session.

## Automated evidence

- A one-time seed adds three unique actors to an existing empty database and does not duplicate them after restart.
- SQLite migration count and application-seed markers are checked.
- Player projections distinguish available, current-session, and other-session claims without leaking owner IDs or notes.
- The repository has 18 passing tests, and TypeScript checks and production builds pass.

## Remaining acceptance work

- Start the server and verify two simultaneous clients cannot win the same claim.
- Verify browser token recovery and claimed ownership after a real server restart.
- Add GM force-release and session invalidation.
- Validate the roster on phone portrait/landscape and desktop with keyboard, pointer, and touch.
- Replace starter actors through the normal JSON import/content-library path once Phase 2 import exists.

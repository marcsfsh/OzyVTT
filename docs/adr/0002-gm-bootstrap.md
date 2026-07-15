# ADR 0002: Localhost-only first-run GM bootstrap

## Status

Accepted.

## Decision

Until a GM password exists, only a request originating from loopback may set it. The server stores a bcrypt hash, not the password. After bootstrap, GM logins receive a signed, time-limited session token.

## Consequences

Players on the LAN cannot race the host to establish GM access. The host must complete initial setup locally before sharing the LAN address.

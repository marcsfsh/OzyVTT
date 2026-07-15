# ADR 0001: Authoritative LAN server

## Status

Accepted.

## Decision

Use one Node.js server as the authority for state, access control, and real-time broadcasts. Browsers connect through HTTP and Socket.IO on the same origin; the server binds to the LAN.

## Consequences

This keeps joining easy from a phone or laptop and prevents client-side state conflicts. It also means the host process is required during play and direct-IP use is trusted-LAN only.

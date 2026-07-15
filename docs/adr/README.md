# Architecture decision records

| ADR | Status | Decision |
| --- | --- | --- |
| [001](0001-authoritative-lan-server.md) | Accepted | Browser application with responsive phone/desktop parity |
| [002](0002-gm-bootstrap.md) | Accepted | Single authoritative local-host server over trusted LAN |
| 003 | Proposed | Choose a mature Canvas/WebGL renderer after the interaction spike |
| [004](0004-application-stack.md) | Accepted | TypeScript end to end with React, Express, Socket.IO, and SQLite target |
| [005](0005-realtime-protocol.md) | Accepted | Server-authoritative WebSocket command/event flow with reconnect snapshots |
| [006](0006-sqlite-persistence.md) | Accepted | Embedded SQLite with migrations, transactional command/event/projection writes, and snapshots |
| [007](0007-canonical-content-format.md) | Accepted | Versioned validated JSON with adapters and extension data |
| [008](0008-rules-representation.md) | Accepted | Declarative rules operations plus inert text fallback |
| 009 | Proposed | Square grid / five-foot cells for MVP; measurement conventions pending spike |
| 010 | Proposed | Manual fog in alpha; dynamic vision is later |
| [011](0011-identity-and-character-claims.md) | Accepted | Player character claims without accounts; GM password authentication |
| [012](0012-dice-authority-and-presentation.md) | Accepted | Server-authoritative dice and replaceable authorized 2D presentation |
| 013 | Proposed | Transactional command/event log with snapshots and bounded undo |
| [014](0014-device-support.md) | Accepted | Functional parity on phone and desktop; exact browser baseline pending |
| 015 | Proposed | Curated, versioned SRD bundle separate from executable code |
| [016](0016-public-integration-api.md) | Proposed | Versioned public integration API over shared authoritative commands, events, authorization, and projections |
| [017](0017-open-source-distribution.md) | Proposed | Open-source self-host distribution, licensing boundaries, contribution policy, and release governance |

Use [template.md](template.md) for material decisions. A proposed ADR becomes accepted only after its spike has evidence. Every row marked Accepted or Proposed above has a dedicated linked record; ADR-003/009/010/013/015 remain index-only entries pending their spikes.

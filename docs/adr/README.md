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
| 010 | Superseded by [022](0022-manual-fog-of-war.md) | Manual fog in alpha; dynamic vision is later |
| [011](0011-identity-and-character-claims.md) | Accepted | Player character claims without accounts; GM password authentication |
| [012](0012-dice-authority-and-presentation.md) | Accepted | Server-authoritative dice and replaceable authorized 2D presentation |
| 013 | Proposed | Transactional command/event log with snapshots and bounded undo |
| [014](0014-device-support.md) | Accepted | Functional parity on phone and desktop; exact browser baseline pending |
| [015](0015-srd-content-source-and-packaging.md) | Accepted | SRD 5.2.1 content from open5e `srd-2024` (CC BY 4.0), vendored and adapted into committed canonical bundles |
| [016](0016-public-integration-api.md) | Proposed | Versioned public integration API over shared authoritative commands, events, authorization, and projections |
| [017](0017-open-source-distribution.md) | Proposed | Open-source self-host distribution, licensing boundaries, contribution policy, and release governance |
| [018](0018-character-sheet-pdf-ingestion.md) | Proposed | Isolated MarkItDown extraction followed by reviewed conversion into canonical character JSON |
| [019](0019-ai-character-participants.md) | Proposed / long-term | Actor-bound AI players with structured persona, bounded autonomy/memory, safe observations, typed intents, and human control |
| [020](0020-combat-rules-engine.md) | Accepted | Server-owned combat rules: validated action resolution with rules modes + audited overrides, action instances, persistent effects, typed damage, and the dying state |
| [021](0021-player-character-sheet.md) | Accepted | Interactive player character sheet now (builder-ready): the play sheet ships; a guided builder is the deferred next step |
| [022](0022-manual-fog-of-war.md) | Accepted | Manual GM-painted fog as ordered rect strokes over the scene boundary — presentation only, never the security boundary |

Use [template.md](template.md) for material decisions. A proposed ADR becomes accepted only after its spike has evidence. Every row with a dedicated file is linked; ADR-003/009/013 remain index-only entries pending their spikes.

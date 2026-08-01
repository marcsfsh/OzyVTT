# Combat-First VTT — Comprehensive Build Plan

> A living product, design, and engineering roadmap for a private home-game virtual tabletop centered on D&D fifth-edition combat.

| Document field | Value |
| --- | --- |
| Status | Active living execution plan |
| Product stage | Phase 0/1 validation and Phase 2 testing-MVP vertical slice in progress |
| Rules baseline | System Reference Document 5.2.1 (2024 fifth-edition rules) |
| Primary use | One GM locally hosting a private home game for a small, known group |
| Distribution direction | Open-source, self-hostable application with a documented public integration API |
| Primary content path | Canonical player-character and monster JSON, with reviewed player-sheet PDF conversion through MarkItDown planned for Version 1 |
| Current checkpoint | A server-authoritative token-interaction slice extends the persisted encounter (no-setup tray, direct GM/owner drag, server grid snap, freeform gridless, hidden-token omission, public-token viewer convergence). A shared annotation layer now adds live grid-snapped measurements and AoE shapes with a full visibility model (public/gm-only/owner-only/owner-gm/gm-actor + owner-delegated movement), and these plus Initiative now reach the TV and a real-`/viewer.html` in-tab preview over Channel B. The battle-map refinement round (eye-dropdown visibility, wrench clear-all, per-shape editor, dockable Initiative, inline dice modifier + recent-roll window, configurable grid-wizard crosshair, renamed tabs) is complete and live-verified; physical multi-device validation remains next |
| Last updated | 2026-07-24 |
| Last implementation audit | 2026-07-19 (SRD combat-rules gap closure tiers A–D — ADR-0020 second amendment) |

> **The backlog moved.** §1.4, §1.7, §2.1-§2.5, §3-§28, §29.1, §29.3-§29.5 and Appendices A and B
> are in [`docs/archive/BUILD_PLAN-backlog-2026-07-24.md`](docs/archive/BUILD_PLAN-backlog-2026-07-24.md),
> with their section numbering unchanged. This file keeps the live roadmap, the ordered queue, the
> risk/gap register, the non-goals and the milestone dashboard. What ships today is
> [`docs/ai-ledger/current-state.md`](docs/ai-ledger/current-state.md).

## 1. Purpose of this document

This document is the project's durable source of truth for what should be built, why it matters, how the work should be sequenced, and how the team will know that the product is actually usable. It is intentionally broader than a feature backlog and less brittle than a line-by-line implementation specification.

It should answer five questions throughout development:

1. Does the proposed work make encounter preparation or combat execution faster and easier?
2. Is the work necessary for the core combat experience, or can a clear manual fallback cover it?
3. Does the work preserve the principle that no player or GM needs technical knowledge to operate the VTT?
4. Is the work being added at the correct milestone, with its dependencies already in place?
5. What observable result proves the work is complete?

This plan should be updated as implementation reveals better answers. Major architectural decisions should be recorded separately as Architecture Decision Records (ADRs) and linked from this document. Completed work should be checked off here only when its acceptance criteria are met.

### 1.1 Status conventions

- `[ ]` — not started
- `[~]` — started, partially implemented, or awaiting acceptance verification
- `[x]` — complete, verified against the stated acceptance criteria, and linked to evidence
- `[-]` — deliberately deferred or removed from scope
- `[!]` — blocked; the blocking condition must also appear in the open-risks table

Do not mark an umbrella item complete when only some clauses are implemented. Leave it `[~]` and name the missing clauses in the current snapshot or outcome ledger. A checkmark records an outcome, not merely code having been written.

### 1.2 Planning hierarchy

Use this order when requirements conflict:

1. The product thesis and design principles in this document
2. Recorded ADRs
3. Milestone scope and exit gates
4. Epic-level acceptance criteria
5. Individual implementation tasks

### 1.3 Living-plan update protocol

Every implementation checkpoint must update this document in the same repository change, or in the immediately following plan-only reconciliation change. The update must:

1. change the relevant milestone and detailed-work checkboxes;
2. add or revise an entry in the implementation outcome ledger;
3. record material architectural/product decisions in Section 8 and `docs/adr/`;
4. add newly discovered blockers, risks, validation gaps, or dependencies to the open-risks table;
5. update the current delivery snapshot and ordered next queue; and
6. advance `Last updated` and `Last implementation audit` when a full reconciliation is performed.

Completion evidence may be an automated test, a manual device/browser result, a schema fixture, a product proof document, an ADR, or a commit. Exit gates remain unchecked until their full multi-user/device scenario has actually been run.

### 1.5 Ordered next queue

This queue is derived from the milestone dependencies and is updated after each checkpoint. It does not replace the milestone plan.

1. Merge and physically re-run the Windows/LAN flow: calibrate a printed-grid and gridless map, pair/present to a separate viewer, start an encounter, drag GM and owned tokens by mouse and touch, verify grid snap and tray return, advance public/hidden turns, reload/revoke/restart, and record usability, firewall, 1080p, and TV-distance findings.
2. ~~Add the smallest intuitive manual-fog/reveal slice over the same recipient-safe scene boundary~~ — **shipped 2026-07-19 (ADR-0022, PR #38)**: per-scene reveal/hide rect strokes, three GM commands with parked-scene prep, GM-dim/player-solid mask rendering on table + viewer, timeline-neutral, smoke-verified at 375 px. Fog is presentation only — hidden geometry/identities stay stripped by the projections regardless. Remaining from the original item: explicit token reveal/hide UX polish (visibility toggling exists via actor visibility; no dedicated map affordance yet) and physical-device validation.
3. Complete the live two-player Socket.IO claim/presence/reconnect/revocation convergence matrix, then repeat the encounter/join/token path on one phone and one laptop.
4. Finish the Phase 1 external-integration proof by adding one recipient-safe game snapshot, one shared idempotent authoritative encounter command, one projected realtime event/resume path, and a tested quick start using existing scoped credentials.
5. Continue the minimum combat loop with canonical actor JSON import, HP/temp HP/damage/healing, conditions, targeting, generic actions, End Turn, and basic undo. AI-controlled characters remain Phase 7 and do not displace this queue.

### 1.6 Open blockers, risks, and validation gaps

There are no active hard blockers to the next queued implementation item.

| ID | Type/state | Affects | Condition | Resolution / trigger |
| --- | --- | --- | --- | --- |
| RISK-001 | Open technical risk | Packaging and persistence | Node 24 built-in `node:sqlite` remains marked release-candidate/experimental in current Node documentation | Pin the host runtime; review API status before production packaging or Node upgrades |
| GAP-001 | Open validation gap | Phase 0 and Phase 1 exit gates | No recorded physical iOS/Android and laptop LAN acceptance pass yet | Run the documented device matrix after roster/claim UI is visible |
| DEC-001 | Open decision | Packaging and support baseline | First supported host OS/deployment form is not selected | Decide before packaging work; development can continue meanwhile |
| GAP-002 | Open process gap | Delivery confidence | CI workflow exists, but branch protection and a recorded remote green run have not been verified in this plan | Verify GitHub settings and link a green run |
| GAP-003 | Resolved 2026-07-15 | Phase 0 decision gate | Accepted ADR-004/005/007/008/011/012/014 previously lacked dedicated records | Dedicated linked records now exist; proposed ADR-018 has a dedicated record and remains blocked on its extraction/packaging spike |
| GAP-004 | Open packaging gap | Production launch | Shared workspace packages currently export TypeScript source, so the supported launch uses Node's `tsx` loader even after the production client build | Add ordered shared-package compilation and runtime exports before packaging the host application |
| RISK-002 | Mitigated in current build; physical validation open | Client startup | The current production build completes without the prior 500 kB warning and its largest application chunk is about 434 kB, but startup/render responsiveness has not been measured on baseline phones | Measure on baseline phones and split scene/UI code before the performance gate if the device budget is missed |
| RISK-003 | Mitigated in current slice; full validation open | Shared-table viewer | The viewer uses separate persisted presentation state, explicit GM commands, active-map-only/no-store map authorization, and allowlisted hidden-aware Initiative/token projection; automated socket/restart proof omits GM-only token identity and position, but fog and non-payload surfaces are not implemented deeply enough for complete negative-state proof | Preserve the projection boundary; add fog fixtures plus DOM, accessibility-tree, log, and cache tests before the Phase 2 gate |
| GAP-005 | Open validation gap | Testing-MVP map/viewer/encounter slice | Automated HTTP/domain/socket/restart coverage passes, but no post-redesign physical TV/second-monitor, Windows browser, touch calibration/token drag, 1080p/4K readability, real LAN pairing, or three-round play result is recorded | Run queue item 1 after merge and log device, address, browser, calibration result, token input/snap, presentation response, encounter convergence, reload, revocation, and visibility findings here |
| GAP-006 | Open usability validation gap; prior design rejected 2026-07-16 | Grid calibration | Hands-on use found the original point/form workflow unintuitive and its overlay container could diverge from image geometry; the replacement begins with one fixed 3×3 diagonal click-drag, derives scale/position/rotation without a direction or cell-count form, previews within the exact image geometry, then offers grouped adjustments and distant-point verification, but has not yet been accepted by the user on a real map | Re-test one clean printed grid, one rotated/cropped grid, one gridless battlemap, and touch placement; iterate until the user can finish without explanation |
| DEC-002 | Open decision | Public release | Application code license, contributor policy, and treatment of separately licensed SRD/content/assets are not settled | Resolve ADR-017 and complete legal/license review before accepting public contributions or publishing a Version 1 release |
| RISK-004 | Open security/compatibility risk | Public API | An integration could bypass UI safeguards, leak private state, or become coupled to unstable internals | Put API adapters over the same command/authorization/projection layer; use scoped tokens, contract tests, explicit versions, capability discovery, and deprecation policy |

## 2. Product definition

### 2.6 Explicit non-goals for the initial product

The following are deliberately outside the core promise unless this plan is revised:

- A full character builder or level-up workflow; PDF ingestion transcribes an existing sheet and does not choose abilities, equipment, spells, advancements, or legal build options
- A general campaign wiki, journal, quest manager, or worldbuilding suite
- A public marketplace or commercial content storefront
- Built-in video conferencing, voice chat, or music streaming
- Three-dimensional maps or miniatures
- A general-purpose macro language or user-authored executable scripts
- A module ecosystem comparable to highly extensible VTTs
- Unrestricted in-process third-party plugins, arbitrary server-side code execution, direct database coupling, or compatibility promises for undocumented internal modules
- Complete semantic automation of every spell, class feature, feat, magic item, environmental rule, and homebrew exception
- Public SaaS billing, user accounts, organization management, or multi-tenant commercial hosting
- Automated encounter balancing as a prerequisite for running combat
- Replacing the GM's judgment about line of sight, cover, unusual movement, or ambiguous rules
- A covert autonomous agent, an AI GM, unrestricted model access to campaign files/private prompts, or an agent that can bypass consent/turn/command confirmation because it is “intelligent”

The later regional/world-map atlas and spatial session-note system described in Sections 18.6–18.8 is a bounded post-Version-1 extension, not a reversal of the initial “no general campaign wiki” constraint. Its purpose is visual, map-anchored recall rather than a general-purpose knowledge-management suite.

## 29. Plan maintenance and immediate next actions

### 29.2 Milestone status table

Keep this small dashboard current near the top or here:

| Phase | Status | Exit gate evidence |
| --- | --- | --- |
| Phase 0 — Product lock and technical proof | In progress | Stack, schema, dice, persistence, LAN URL, renderer, scoped-credential/API foundation, map calibration, viewer presentation, and accepted-decision records exist; physical-device/network, renderer stress/input, realtime/API end-to-end conformance, wireframes, and unresolved proposed decisions block the gate; ADR-018/019 evidence is due only before their later implementation phases |
| Phase 1 — Local-host foundation | In progress | Auth/session revocation/rate limiting, durable serialized roster/claims, remembered recovery, GM force-release, verified-session presence, mounted API, scoped credential lifecycle/UI, recipient projections, CI, health, and transactional SQLite exist; full socket/browser claim convergence, API snapshot/command/event proof, diagnostics, rate-limit completion, and physical-device acceptance block the gate |
| Phase 2 — Minimum playable vertical slice | Implementation active; authoritative encounter/token slice implemented | Normal-UI map upload/library/guided grid or gridless setup, authenticated combat map, persisted encounter/Initiative and direct token movement, server grid snap, owned-token control, hidden-safe player/viewer token/current-turn convergence, paired presentation, focus/ping/measurement, reconnect, and active-map privacy are implemented; fog, targeting, full actor-definition/instance lifecycle, HP/actions/undo, actor import, phone/TV acceptance, per-display follow/highlight, and complete API equivalence remain |
| Phase 3 — Playable alpha | Not started | — |
| Phase 4 — Rules-assisted beta | Not started | — |
| Phase 5 — Preparation speed/content | Not started | — |
| Phase 6 — Version 1 hardening | Not started | — |
| Phase 7 — AI character participants | Post-Version-1 | Structured persona/autonomy/memory and actor-bound safe agent contracts are defined; implementation waits on stable human combat/API/presence plus accepted ADR-019 |

## Roadmap

_Awaiting Plan B / D7 (Developer 2): a short honest roadmap, 20 lines or fewer, no checkboxes_
_(Plan A §8 Q7 — the archived backlog keeps its marks as the historical record)._

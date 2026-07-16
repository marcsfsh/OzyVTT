# ADR-019: AI-controlled character participants and persona policy

- Status: Proposed / long-term
- Date: 2026-07-16

## Context

The long-term product should allow AI agents to play assigned characters. The goal is not a tactical bot that always selects a mathematically optimal combat action. It is a configurable, clearly disclosed roleplaying participant whose social and tactical choices reflect an authored personality while remaining subject to ordinary rules, visibility, permissions, table consent, and immediate human control.

## Decision drivers

- Preserve server authority and the public API as the only consequential action boundary.
- Prevent AI status from granting GM knowledge, extra actors, or broader scopes.
- Make personality structured, inspectable, portable, and usable without prompt engineering.
- Support persona-consistent, sometimes deliberately non-optimal but valid choices.
- Separate personality/preferences from autonomy, authorization, rules legality, and model-provider configuration.
- Keep provider/model implementations replaceable and compatible with self-hosting.
- Make prompt injection, memory poisoning, privacy, latency, runaway cost, consent, and human takeover first-class concerns.

## Considered options

- Privileged in-process AI with direct domain/database access: rejected because it bypasses public contracts, isolation, and ordinary authorization.
- Combat-only optimizer: rejected because it does not meet the roleplaying-participant goal and would make characters converge on the same behavior.
- One free-form system prompt as persona and policy: rejected because permissions, autonomy, memory, and behavior become opaque and injection-prone.
- Provider-neutral external agent over actor-bound API contracts with structured persona/autonomy/memory: current direction.

## Proposed decision

Represent an AI player as an explicit `agent-player` principal with a narrow, revocable, game- and actor-bound credential. The agent receives a purpose-built recipient-safe observation and returns a typed intent. All accepted actions pass through the same validation, authorization, idempotency, revision, domain, event, projection, and audit paths used by human/API clients.

Store a versioned structured persona separately from the actor definition and separately from autonomy/permission policy. Persona includes values, goals, bonds/flaws, relationships, temperament, speech style, knowledge boundaries, tactical/exploration preferences, risk tolerance, moral/behavioral limits, and weighted decision priorities. It influences preference and expression but cannot change legal actions, dice, scopes, visibility, or turn authority.

Use a provider-neutral cancellable adapter. Provide explicit GM/table consent and disclosure, configurable autonomy by action category, bounded inspectable memory, prompt-injection isolation, usage/time limits, and immediate pause/edit/reject/takeover/revoke controls. Do not require or persist hidden chain-of-thought; concise decision tags and command outcomes are sufficient for audit.

## Consequences and tradeoffs

- The stable API, complete combat commands, safe projections, presence, and credential lifecycle must exist first.
- Structured configuration takes more design work than a prompt box but is safer and more understandable.
- Different personas can choose different valid actions, making deterministic testing quality-oriented rather than requiring one “correct” move.
- Model/provider quality and availability remain variable; scripted fake agents are required for CI.
- Social consent, speech cadence, moderation, privacy, and cost controls become product responsibilities.
- This is post-Version-1 and does not delay the human multiplayer vertical slice.

## Mobile impact

Phone users must be able to identify AI participants/status, review or edit concise persona/autonomy settings, approve/reject a pending consequential intent, pause/mute/take over, and understand provider errors without navigating raw prompts.

## Security and visibility impact

Observations are minimized recipient projections. Untrusted chat, notes, imports, maps, events, and errors remain labeled data and cannot override system/persona/autonomy policy or invoke tools. Provider and VTT credentials are separate and never exposed in prompts/logs/persona exports. Memory writes are typed, visibility-aware, bounded, inspectable, and subject to approval. Revocation or human takeover immediately prevents later agent commands.

## Migration and reversibility

Persona, autonomy, provider configuration, and memory are separate optional records. Disabling/removing an agent leaves the canonical actor and encounter state usable by a human. Provider adapters and persona schema versions migrate independently from actor definitions.

## Validation evidence required before acceptance

- Stable public observation/intent/command contracts and actor-bound credential tests.
- Deterministic fake agents with contrasting personas choose different valid actions in the same scenarios.
- Prompt-injection, memory-poisoning, secret-exfiltration, scope, revocation, latency, retry/cost, and provider-outage tests.
- Immediate pause/takeover/revoke and human replacement without character-state loss.
- Consenting human-table social/combat playtests demonstrating recognizable persona consistency without disruptive optimization or speech behavior.
- At least one documented self-host-friendly provider path plus disclosure for remote-provider retention/privacy.

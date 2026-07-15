# ADR-012: Dice authority and presentation

## Status

Accepted — 2026-07-15.

## Context and decision drivers

Dice results are consequential shared state (they drive HP, hit/miss, and save outcomes) and carry hidden-information rules (a blind GM roll, a self-only check) that must be enforced consistently regardless of which client rolled. The server-authoritative model (ADR-005) and the no-imported-code rules representation (ADR-008) both constrain how a roll can be generated and recorded; the result must also be presentable to players and the GM without letting presentation influence or duplicate the outcome.

## Considered options

- Client-generated rolls reported to the server: lowest latency and simplest client code, but lets any client fabricate or bias results and cannot enforce visibility (blind/GM-only rolls) since the requester already saw its own outcome before the server could gate it.
- Server-generated rolls using `Math.random`: still authoritative, but a non-cryptographic PRNG is a weaker fairness guarantee for a game mechanic players will scrutinize.
- Server-generated rolls using a cryptographic random source, with an animated or replaceable presentation layer that only displays an already-decided result: keeps the outcome authoritative and auditable while leaving room to improve or replace the visual dice presentation later without touching roll authority.

## Decision

All dice rolls are generated and recorded on the server. A roll request (formula, purpose, requested visibility, optional actor) is validated, authorized (a player may only roll for an actor they own; only the GM may request a GM-only roll — `apps/server/src/index.ts`), and resolved using Node's cryptographic `randomInt` (`node:crypto`), never `Math.random` and never client-supplied faces. Every roll is persisted as an immutable record containing its formula, normalized formula, every die's face and whether it was kept or discarded (so keep-highest/lowest and Advantage/Disadvantage remain auditable), signed modifiers, total, visibility, and provenance (command ID, initiating session, initiating role) — the `RollRecord`/`PlayerRollRecord` shapes in `packages/domain`. Visibility is enforced at the server projection boundary (`apps/server/src/projections.ts`) per the modes documented in `docs/product/phase-0-dice-spike.md`: public (everyone sees the full result), self-only (only roller and GM), blind player roll (roller sees only a confirmation; GM sees the full result), and GM-only (only the GM sees anything). The client (`apps/client/src/dice/DicePanel.tsx`) only submits a formula/purpose/visibility with a locally generated command ID and renders whatever authorized `RollRecord` the server returns; it computes no faces and decides no visibility. Presentation (currently a numeric/face-chip result card) is explicitly a replaceable layer over an already-decided, already-authorized result.

## Consequences and tradeoffs

Every roll requires a server round trip; there is no offline or client-only dice path. This is accepted for the same reason as ADR-005: it is the only way to guarantee fairness and enforce hidden-information visibility, and trusted-LAN latency makes the round trip acceptable for turn-based play. Because presentation never influences the result, a future richer 2D or 3D dice animation can be swapped in without touching roll generation, persistence, or visibility logic.

## Mobile, security, and visibility impact

Visibility filtering happens once, at the server projection boundary, so a phone and a desktop browser receive identically-scoped payloads for the same session — there is no client-side hiding of a blind or GM-only roll that a curious user could inspect via devtools to reveal early. `PlayerRollRecord` omits the raw `initiatorSessionId` other players would not need, preventing cross-player deanonymization of "who rolled that." Cryptographic randomness and full per-die provenance make the result auditable by the GM without relying on client-reported values.

## Migration / reversibility

The result contract (formula, per-die faces/kept, modifiers, total, visibility, provenance) is designed to support future critical-damage transformation, rerolls/replacements, labels, and per-recipient whispers without changing roll authority (`docs/product/phase-0-dice-spike.md`, "Still outside this proof"). Presentation can be replaced independently of this ADR; only a change to who generates or records a roll would require revisiting this decision.

## Validation evidence

`docs/product/phase-0-dice-spike.md` documents the proven grammar, visibility matrix, and the explicit ban on `eval`/`Function`/imported executable code in formula handling. `packages/rules-5e/test/dice.test.ts` covers formula parsing and resolution, including keep-highest/lowest. Runtime socket validation rejects malformed visibility, purpose, IDs, and formulas before persistence (`docs/product/phase-0-dice-spike.md`). Full action-resolution integration (an attack producing typed damage, a save, and an applied condition) remains open per BUILD_PLAN.md's technical-spike checklist and is not yet closed by this ADR.

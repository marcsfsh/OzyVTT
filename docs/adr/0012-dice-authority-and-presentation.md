# ADR-012: Dice authority and presentation

## Status

Accepted — 2026-07-15. Amended 2026-10-16: who rolls the dice (below).

## Context and decision drivers

Dice results are consequential shared state (they drive HP, hit/miss, and save outcomes) and carry hidden-information rules (a blind GM roll, a self-only check) that must be enforced consistently regardless of which client rolled. The server-authoritative model (ADR-005) and the no-imported-code rules representation (ADR-008) both constrain how a roll can be generated and recorded; the result must also be presentable to players and the GM without letting presentation influence or duplicate the outcome.

## Considered options

- Client-generated rolls reported to the server: lowest latency and simplest client code, but lets any client fabricate or bias results and cannot enforce visibility (blind/GM-only rolls) since the requester already saw its own outcome before the server could gate it.
- Server-generated rolls using `Math.random`: still authoritative, but a non-cryptographic PRNG is a weaker fairness guarantee for a game mechanic players will scrutinize.
- Server-generated rolls using a cryptographic random source, with an animated or replaceable presentation layer that only displays an already-decided result: keeps the outcome authoritative and auditable while leaving room to improve or replace the visual dice presentation later without touching roll authority.

## Decision

All dice rolls are generated and recorded on the server, using Node's cryptographic `randomInt` (`node:crypto`), never `Math.random`. The one exception is a die typed from a physical die, which the table may allow (below); it is recorded with `typed: true`. A roll request is validated and authorized on the server: a player may only roll for an actor they own, only the GM may request a GM-only roll, and a hidden creature's roll is always the GM's. Every roll is persisted as an immutable record containing its formula, normalized formula, every die's face and whether it was kept or discarded (so keep-highest/lowest and Advantage/Disadvantage remain auditable), signed modifiers, total, visibility, and provenance (command ID, initiating session, initiating role) — the `RollRecord`/`PlayerRollRecord` shapes in `packages/domain`. Visibility is enforced at the server projection boundary (`apps/server/src/projections.ts`): public (everyone sees the full result), self-only (only roller and GM), blind player roll (roller sees only a confirmation; GM sees the full result), and GM-only (only the GM sees anything). The dice panel (`apps/client/src/dice/DicePanel.tsx`) submits a formula, purpose and visibility and renders whatever authorized record the server returns. The sheet sends no formula for a check or a save: it names the check (`check.roll`) or the save (`save.roll`), and the server works out the bonus and the Advantage or Disadvantage. Presentation (currently a numeric/face-chip result card) is explicitly a replaceable layer over an already-decided, already-authorized result.

### Who rolls the dice (2026-10-16)

- **Players supply die faces, never totals or modes.** A typed die is the face a physical d20 shows (the one that counts under Advantage or Disadvantage). The server adds the bonus and applies every rule: the automatic failure of a Strength or Dexterity save, a natural 1 or 20, cover, Exhaustion. A player's typed total, typed critical or natural 1, and manual save total are refused; the GM may still type a final total, which stands as a ruling (`attackTotal` with `critical` or `fumble`, a save answered `manual`).
- **One table setting decides whether players may type their dice:** `builderPolicy.typedRolls`, labelled "Players may type what their dice show". It covers every die a player can type: checks, saves, attacks, damage, death saves, initiative, the dice panel's typed numbers, and rolled ability scores and hit points in the builder. `open` is the default, which keeps tables that roll physical dice working; `gm-only` refuses a player's typed faces, and the server rolls. The GM may always type.
- **A player's Advantage or Disadvantage choice is ignored.** The engine counts the sources and cancels them per the rules; the roll card names each source, so a player sees why. The GM may force a mode, which the card names as the GM's choice.
- **A die shown before it counts is held on the server** (`apps/server/src/held-rolls.ts`, `GameState.heldRolls`, GM-only). A previewed save, death save, opportunity attack or attack keeps its d20s under the roll's key, so a second preview returns the same die and the confirm uses it; nothing new is recorded. An attack's die belongs to the attacker's turn (a later turn throws afresh); the others belong to their pending roll until it is answered or dismissed. A typed die stands until a typed reroll replaces it, and a die the server threw is never replaced by a typed one.
- **Heroic Inspiration is a player's only reroll** (SRD: "reroll any die immediately after rolling it"). Spending it rerolls the lowest d20 of a held roll, or of the character's latest check while it is still their latest roll (`check.reroll`); it is the only die whose reroll can help under either mode. The GM may reroll any held roll freely. A character holds at most one; the GM gives it, a Human gains it on finishing a Long Rest, and a Champion takes it at the start of its turn in a fight.
- **Every prompt in the app offers the same controls** (`apps/client/src/encounter/RollControls.tsx`): Roll, or the face a physical d20 shows while the table lets this browser type (`apps/client/src/dice/roll-preference.ts` follows the table's setting), then Confirm, which applies the held die. The result names what gave it Advantage or Disadvantage. Only the GM sees the Advantage and Disadvantage buttons and a free Reroll; a player sees "Reroll · Heroic Inspiration" while they hold it, typed when the die was typed. The app offers faces only; the GM's typed total stays in the API as a ruling.

## Consequences and tradeoffs

Every roll requires a server round trip; there is no offline or client-only dice path. This is accepted for the same reason as ADR-005: it is the only way to guarantee fairness and enforce hidden-information visibility, and trusted-LAN latency makes the round trip acceptable for turn-based play. Because presentation never influences the result, a future richer 2D or 3D dice animation can be swapped in without touching roll generation, persistence, or visibility logic. A table that allows typed dice trusts its players' faces; the setting exists so a table that does not can turn it off.

## Mobile, security, and visibility impact

Visibility filtering happens once, at the server projection boundary, so a phone and a desktop browser receive identically-scoped payloads for the same session — there is no client-side hiding of a blind or GM-only roll that a curious user could inspect via devtools to reveal early. `PlayerRollRecord` omits the raw `initiatorSessionId` other players would not need, preventing cross-player deanonymization of "who rolled that." Held dice never reach a player's projection. Cryptographic randomness and full per-die provenance make the result auditable by the GM without relying on client-reported values.

## Migration / reversibility

The result contract (formula, per-die faces/kept, modifiers, total, visibility, provenance, `typed`) carries rerolls as new records labelled as rerolls. Presentation can be replaced independently of this ADR; only a change to who generates or records a roll would require revisiting this decision.

## Validation evidence

`packages/rules-5e/test/dice.test.ts` covers formula parsing and resolution, including keep-highest/lowest and held faces. `apps/server/test/dice-authority.test.ts` covers held previews, typed faces under the table setting, ignored player modes and Heroic Inspiration rerolls; `check-rolls.test.ts` the server's check roll and its reroll, and `roll-calls.test.ts` the GM's calls for a roll. On the client, `held-dice.test.tsx` covers the prompts (faces only, no player mode, Confirm without a die, the GM's forced mode and reroll, Heroic Inspiration), `sheet-checks.test.tsx` the sheet's server-rolled checks and saves, and `roll-calls.test.tsx` the call form and the player's card. Runtime validation rejects malformed visibility, purpose, IDs, and formulas before persistence.

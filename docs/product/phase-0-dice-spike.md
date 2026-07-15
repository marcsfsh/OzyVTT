# Phase 0 server-authoritative dice spike

## Proven path

1. A client submits a unique command ID, formula, purpose, and authorized visibility.
2. The server validates the request and parses the formula with a bounded grammar; it never uses `eval`, `Function`, or imported executable code.
3. Live faces come from Node's cryptographic `randomInt`; tests inject deterministic face sequences.
4. The server records every face—including discarded Advantage/Disadvantage dice—modifiers, total, provenance, visibility, and timestamp.
5. The roll is persisted through the command/event proof and projected separately to the GM and each player.
6. Authorized clients render a responsive 2D result card. Presentation has no role in generating the result.

## Supported proof grammar

- d4, d6, d8, d10, d12, d20, and d100;
- quantities and multiple groups, such as `2d6 + 1d4 - 2`;
- signed integer modifiers;
- keep-high/keep-low, such as `2d20kh1 + 5` and `2d20kl1`;
- hard limits on formula length, terms, and total dice.

## Visibility behavior

| Mode | Roller | Other players | GM |
| --- | --- | --- | --- |
| Public | Full result | Full result | Full result |
| Self-only | Full result | Nothing | Full result |
| Blind player roll | Confirmation only | Nothing | Full result |
| GM-only | Nothing | Nothing | Full result |

Player projections omit private session identifiers. Runtime socket validation rejects malformed visibility, purpose, IDs, and formulas before persistence.

## Still outside this proof

Critical-damage transformation, rerolls/replacements, labels, per-recipient whispers, actor action integration, and 3D presentation remain later work. The immutable result and projection contract is designed to support them without changing roll authority.

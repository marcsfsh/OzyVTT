# Actor definition v1

`actor-definition.v1` is a reusable, immutable definition imported from JSON. It has no current HP, encounter placement, ownership, active effects, or turn state. Those will belong to separate actor-instance, token, and encounter entities.

The machine-readable JSON Schema is [../../packages/schemas/json/actor-definition.v1.schema.json](../../packages/schemas/json/actor-definition.v1.schema.json). Representative files live in `packages/test-fixtures/actors/`.

## Current deliberate limits

- Covers identity, provenance, base ability scores, AC, HP maximum/default formula, speed, minimal token defaults, and common action metadata.
- Action formulas are deliberately constrained to a safe subset such as `1d8 + 3`; the later dice grammar will become the single broader parser/evaluator.
- Unsupported rules text remains in `description`; it cannot block import or execute behavior.
- It is not yet an adapter for any third-party or player-sheet JSON format. The next import task will map the actual supplied character data into this canonical form.

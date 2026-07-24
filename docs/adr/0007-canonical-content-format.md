# ADR-007: Canonical content format

## Status

Accepted — 2026-07-15.

## Context and decision drivers

Actors, actions, and later maps/encounters must be importable, validated, versioned, and safe to persist without ever executing imported content as code. The format must support a small deliberate v1 (identity, ability scores, AC, HP, actions) while leaving room for content the schema does not yet model, and must stay compatible with the server-authoritative command/persistence model (ADR-005, ADR-006) and the public API (ADR-016).

## Considered options

- Free-form/untyped JSON import: fastest to prototype, but gives no compile-time or runtime guarantee about what a client or the domain layer can rely on, and invites silently-broken imports.
- A binary or proprietary content format: could be more compact, but adds tooling friction for GMs preparing content and for future third-party importers/integrations, with no offsetting benefit at this scale.
- Executable content definitions (e.g. imported JavaScript/expression code for actions): most flexible, but directly violates the requirement to never evaluate imported executable code (ADR-008) and is a supply-chain and safety risk.
- Versioned, schema-validated JSON with explicit extension fields: keeps content data-only and inert, lets `packages/schemas` reject malformed imports before they reach domain code, and supports additive evolution via `schemaVersion` and an `extensions` bag.

## Decision

Canonical content — actor definitions today, and later maps/encounters — is versioned, schema-validated JSON. Each document carries an explicit schema identifier and integer `schemaVersion` (for example `ACTOR_DEFINITION_SCHEMA_VERSION`); schemas are defined once, at runtime with Zod (`packages/schemas/src/index.ts`) and, for the actor-definition v1 contract, also published as machine-readable JSON Schema (`packages/schemas/json/actor-definition.v1.schema.json`, documented in `docs/product/actor-definition-v1.md`). Deterministic, common fields (identity, provenance, ability scores, AC, HP, speed, structured action formulas/attacks/saves/damage) are typed and validated; anything the schema does not yet model stays in a bounded, size-limited `extensions` record or an inert `description` text field rather than blocking import. Adapters map external/third-party formats into this canonical shape rather than the domain accepting arbitrary external shapes directly.

## Consequences and tradeoffs

Adding a new structured field is a schema change with a version bump, not a silent behavioral change; older saved content keeps its own `schemaVersion` and is migrated deliberately rather than reinterpreted. Unsupported or not-yet-modeled rules text is preserved as inert description rather than dropped, so an import is never blocked by a mechanic the schema doesn't support yet — but that also means such mechanics are not automated until a later schema version adds structured fields for them (see BUILD_PLAN.md §7.3, "Structured core, text fallback").

## Mobile, security, and visibility impact

Content is data, not code: Zod/JSON Schema validation happens before anything is persisted or broadcast, so a malformed or hostile import cannot reach the domain layer or a client as executable behavior. Because content is plain validated JSON, the same import path works identically from a phone's file picker or a desktop upload; there is no platform-specific import mechanism.

## Migration / reversibility

`schemaVersion` and `schemaId` are pinned per document (see the architectural invariant in BUILD_PLAN.md §9.3 that "ruleset and schema versions are pinned to saved content/encounters and migrated deliberately"). A new schema version can be introduced alongside the old one, with explicit migration rather than in-place reinterpretation of existing content. `packages/content-srd-5.2.1` is reserved for curated, normalized SRD content bundles once conversion begins, and `packages/test-fixtures` already holds representative fixtures — both are separate from executable code, so content-format changes do not require code changes to the packages that merely consume it.

## Validation evidence

`packages/schemas/test/actor-definition.test.ts` validates the actor-definition schema, including the `superRefine` rule that player-character definitions must use the friendly token disposition. `docs/product/actor-definition-v1.md` documents the current deliberate v1 limits (no HP/position/ownership yet; safe dice-formula subset only). Representative fixtures live in `packages/test-fixtures/actors/`. Bulk monster conversion and a real third-party adapter remain future work (ADR-015 SRD content packaging, still Proposed) and are not required for this ADR's acceptance.

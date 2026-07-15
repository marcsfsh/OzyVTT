# ADR-008: Rules representation

## Status

Accepted — 2026-07-15.

## Context and decision drivers

Imported content (actions, damage, saves) must be able to describe 5e mechanics precisely enough to automate the deterministic parts (attack rolls, damage, saves) while never letting imported content run as code on the server or client. BUILD_PLAN.md §7 sets an explicit automation-level ladder (Reference/Calculate/Propose/Apply/Enforce) and requires an obvious manual fallback and visible calculation for anything automated. The rules layer must also be testable in isolation from the server and browser.

## Considered options

- Evaluate imported expressions/scripts (e.g. `eval`, `new Function`, or a scripting sandbox) to describe arbitrary mechanics: maximally flexible, but is exactly the arbitrary-code-execution risk the product must avoid for content imported from files a GM downloads, and undermines auditability of what a "roll" or "damage" actually does.
- A general rules engine/DSL interpreter: still ultimately executes imported logic at runtime and adds interpreter complexity disproportionate to a curated 5e SRD ruleset.
- Fully hard-coded rules in application code with no data-driven content: safest against code injection, but makes every new monster/action a code change instead of a content import, which does not scale to bulk SRD conversion.
- Typed declarative operations (structured attack/save/damage/formula fields) plus inert text fallback for anything not yet modeled: keeps content data-only, lets the domain layer interpret a known, tested vocabulary, and never blocks import on an unsupported mechanic.

## Decision

`packages/rules-5e` exposes a declarative operation vocabulary only: content can describe a dice intent (formula plus purpose) but never execute code (see the package's own documentation comment). Dice formulas are parsed by a hand-written, bounded grammar (`parseDiceFormula` in `packages/rules-5e/src/dice.ts`) with hard caps on formula length, term count, and total dice, restricted to the standard die types (d4/d6/d8/d10/d12/d20/d100), and resolved by a pure `resolveDice` function that takes an injected random source — there is no string evaluation of a formula as code. The same bounded formula pattern is enforced independently at the content boundary by `DiceFormulaSchema` in `packages/schemas` and by the mirrored `$defs.dice.pattern` in the actor-definition JSON Schema, so an unsafe formula is rejected at import time, not just at roll time. Structured, deterministic action fields (attack bonus, save DC/ability, typed damage components with bounded formulas) are typed and automatable; anything the schema does not yet model stays in the action's inert `description` text, which is displayed to the user but never executed (BUILD_PLAN.md §7.3, "Structured core, text fallback").

## Consequences and tradeoffs

Mechanics without a structured representation are not automated — they display as reference text and require a manual ruling — until a future schema version adds fields for them. This trades short-term coverage for a guarantee that automation never runs unvetted logic. Extending automation coverage means adding new typed, tested operations to `packages/rules-5e`/`packages/schemas`, not making the parser or evaluator more permissive.

## Mobile, security, and visibility impact

Because rules content is data validated against a bounded grammar/schema, a malicious or malformed import cannot execute arbitrary code on the server or in a player's or GM's browser regardless of device. The same formula parser and caps apply uniformly on phone and desktop clients since resolution always happens server-side (ADR-012); there is no separate, less-constrained mobile code path.

## Migration / reversibility

New declarative operations (new attack shapes, condition effects, save types) can be added to `packages/rules-5e` and `packages/schemas` incrementally, versioned alongside the content schema (ADR-007), without touching the parsing/evaluation safety model. Should a future need arise for more expressive content, it would require a new ADR explicitly re-examining the no-imported-code guarantee — this decision is not expected to be reversed casually.

## Validation evidence

`packages/rules-5e/test/dice.test.ts` and `packages/schemas/test/actor-definition.test.ts` cover formula parsing, keep-highest/lowest resolution, and schema rejection of unsafe/malformed formulas. A repository-wide search for `eval(` and `new Function` in `packages/rules-5e` and `packages/domain` finds no matches, confirming no imported executable code path exists in the rules or domain layers. `docs/product/phase-0-dice-spike.md` documents the proven grammar and explicitly states the server never uses `eval`, `Function`, or imported executable code.

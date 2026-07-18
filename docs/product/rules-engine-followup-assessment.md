# Rules-engine follow-up milestone — implementation assessment and corrected scope

Date: 2026-07-18 · Baseline: PR #38 (ADR-0020 combat rules engine) · Status: living
roadmap for the remaining rules-engine work.

The follow-up milestone prompt ("Complete D&D 5e (2024) Encounter Rules Enforcement")
was written without full knowledge of the shipped baseline. Per the owner's
instruction, this document is the review that preceded implementation: what the
prompt asked for that **already exists**, where its assumptions were **corrected**,
what the **second slice shipped** (same PR), and what **genuinely remains**, in
priority order. Rule-by-rule SRD verification uses the in-repo SRD 5.2.1 sources
(`5.2.1 SRD.md` and the structured `packages/content-srd-5.2.1` bundles) — an
external SRD mirror is unnecessary and outside this project's repository scope.

## 1. Already shipped by the baseline (do not rebuild)

| Prompt ask | Shipped as (ADR-0020) |
| --- | --- |
| Action economy validation (action/bonus/reaction, per turn) | `planEconomy` in `apps/server/src/action-resolution.ts`; strict/assisted/freeform per encounter |
| Compound actions with component tracking | Action instances: generic `attack` pool (Extra Attack mixes weapons), actionId-keyed Multiattack components |
| Typed, sourced damage with defenses | `actor.apply-damage` typed parts → immunity → resistance → vulnerability with per-part explainable breakdown |
| Executable condition riders with sources and escape DCs | `onHit` riders as source-linked `EffectInstance`s (grapple releases at source 0 HP) |
| Feature prerequisites and limited uses | `requiresEffectTag`, `uses` (turn/encounter/long-rest, shared pools) |
| Zero-HP state machine | Dying/death saves/stability/instant death across all five HP entry points; `death-save.roll` |
| Machine-readable rejections + audited override | `RulesBlockedError {rule, overridable}` → socket `blocked` / HTTP 409 `details.blocked`; `override {reason}` logged kind `override` |
| Explainable advantage/disadvantage | Aggregated sources incl. 2024 prone distance rule, unconscious-adjacent auto-crit |
| Regression tests from the two replay archives | `apps/server/test/combat-rules-regression.test.ts` |

## 2. Corrections to the prompt's assumptions

1. **"Strict-only; remove Assisted/Freeform from normal gameplay" — rejected.**
   Strict is already the default for every encounter. Freeform is load-bearing
   compatibility surface: pre-ADR-0020 journals/archives replay only under freeform,
   and ADR-0020 documents that. Assisted is the GM's table-pacing middle ground.
   Removing them buys no additional safety (strict is default-on) and breaks replay.
   The modes stay; "administrative correction" already exists as the documented
   manual escape hatches (`turn.use`, amount-only damage, `actor.set-hp`,
   `actor.set-condition`) plus the audited override.
2. **"Transactional multi-step action lifecycle (intent → pending decisions → atomic
   commit)" — rejected as a wholesale replacement.** ADR-0020 deliberately chose
   one-command-one-roll action instances over an atomic execute-action pipeline: it
   preserves journal/archive semantics and the GM's between-rolls target choice.
   The prompt's underlying need — decision windows that interrupt resolution — is
   real and is being met *incrementally* on the pendingSaves pattern (pendingSaves,
   now pendingReactions; spell/concentration prompts later), not by a new engine.
3. **"Use github.com/downfallx/dnd-5e-srd-markdown as the SRD reference" —
   substituted.** This session's repository access is scoped to `marcsfsh/vtt`
   only. The repo already vendors the complete SRD 5.2.1 text and structured
   bundles; those are the verification source (and are what the ETL builds from).
4. **"No silent freeform fallback for unstructured content" — partially corrected.**
   The engine never *silently* falls back: prose-only Multiattack degrades to
   explicit warnings, and unstructured actions resolve only their structured parts.
   A full import-compatibility report (per-action compatible/translated/incomplete/
   unsupported states at import time) remains open (§4).
5. **"Final archived state is captured before the end command" — confirmed real and
   fixed** in this slice (archive v3 `postEncounterState`, see §3).

## 3. Shipped in this second slice (same branch/PR)

- **Reactions as first-class pending prompts** (the ADR-0020 unsupported list's top
  item, on the stated pendingSaves template): declared `reaction {trigger:
  "hit-by-attack", response: "half-damage"}` vocabulary on actions (Uncanny Dodge);
  a qualifying hit parks its rolled damage on `combat.pendingReactions` instead of
  the apply button; `reaction.answer` (GM or owning player) applies half (use —
  spends the reaction) or full (decline); `reaction.dismiss` (GM) drops the prompt
  without damage; prompts persist until answered so parked damage is never lost.
  Eligibility respects spent reactions, incapacitation, and freeform mode. Both
  transports + OpenAPI + typed routes; player projection is own-prompts-only with
  source ids stripped and hidden sources masked.
- **Incapacitation gates the economy**: `condition.incapacitated` violations for
  actions/bonus actions/reactions while Incapacitated/Paralyzed/Petrified/Stunned/
  Unconscious (SRD 2024), same strict/assisted/override handling as every rule.
- **Available-actions read API** (`GET /api/v1/game/actors/{actorId}/available-actions`
  + `actor:available-actions` socket read): per-action availability computed by the
  *same* evaluation the resolve path enforces (`evaluateActionEconomy` is shared, so
  report and enforcement cannot drift), with machine-readable rule violations,
  uses remaining, and open-instance counts. GM any combatant; player their claimed
  character. This is the prompt's "UI generated from state" foundation.
- **Archive v3 `postEncounterState`**: encounter archives now also capture the state
  *after* `encounter.end` ran — combat cleared, end-of-fight effect sweeps and their
  on-end grants (Frenzy's Exhaustion) landed. Additive; `finalState` (last live
  picture) is unchanged.

## 4. Genuinely remaining (priority order, one coherent slice each)

1. **More reaction/interrupt triggers**: opportunity attacks on movement (needs
   movement legality below), Parry/Shield-style AC responses, damage-taken triggers
   (Hellish Rebuke). The prompt/answer plumbing is now generic; each trigger is
   vocabulary + eligibility + an answer effect.
2. **Triggered features**: Sneak Attack *eligibility* (advantage / adjacent ally —
   only its once-per-turn pool ships today), Relentless Endurance (zero-HP
   interception prompt), Dark One's Blessing (on-kill temp HP).
3. **Movement/range/reach legality**: speed budget per turn, reach/range checking on
   resolve (distance plumbing already exists via `distanceFeet`), difficult
   terrain, opportunity-attack windows. Server-authoritative `movement.preview`.
4. **Spellcasting structure + concentration**: slots as a `uses`-like resource,
   concentration as an effect with damage-triggered CON save prompts (the
   pendingSaves machinery fits), target-scoped effects (Hex).
5. **Import compatibility states + pre-encounter readiness report**: per-action
   compatible/translated/incomplete/unsupported classification at import, surfaced
   before an encounter starts (extends the ETL's confident-pattern philosophy).
6. **2024 generic action taxonomy**: Dash/Disengage/Dodge/Help/Hide/Influence/Ready/
   Search/Study/Utilize as first-class actions with effects where they have teeth
   (Dodge → incoming-attack-disadvantage effect; Dash → movement budget).
7. **Semantic replay/export upgrades** beyond archive v3 (per-command rules
   annotations in the journal).
8. **Client adoption of available-actions**: the GM runner still computes display
   hints locally from the same inputs; swapping to the server read is now possible
   without new server work. Player-invoked `action.resolve` remains GM-only by
   role-boundary design.

Non-goals reaffirmed: no atomic multi-roll execute-action engine, no removal of
rules modes, no external SRD dependency, no 2014-ruleset declarations this phase.

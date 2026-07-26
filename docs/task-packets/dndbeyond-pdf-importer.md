# D&D Beyond character-sheet PDF importer (Phase 1.5)

## Goal
A GM imports a D&D Beyond **PDF export** and gets a *review-then-confirm* flow that
produces a schema-valid `ActorDefinition`, reusing the existing import path — so players
can bring an existing DDB character without hand-authoring JSON. Deterministic extraction,
no cloud, no ML at runtime.

## Scope
- **In (required):**
  - A deterministic client-side extractor (`pdfjs-dist`) for the **DDB 2024 sheet layout**,
    a TypeScript port of the proven Python POC: font-split (the character's values render in
    `Helvetica`; template labels in `ScalaSansOffc`), `=== SECTION ===` / `* entry` grammar for
    reflowing lists, and label-anchored reads for the fixed stat block.
  - Fields: identity + `character.classes[]`, `abilityScores`, `armorClass`, `hitPoints`,
    `speedFeet`, `initiativeBonus`, derived `proficiencyBonus`; `proficiencies.saves` +
    `.skills` (recovering `proficient` / `expertise` from the P/E dots); `spellcasting`
    (ability, save DC, attack, per-level `slots`, warlock `pact`, `spells[]` with
    `prepared`/`alwaysPrepared` from the O/P markers); weapons → `actions[]`;
    `startingInventory[]`; `startingCurrency`.
  - **Review UI**: show every extracted field grouped as it will appear on the sheet, surface
    per-field **warnings / low-confidence flags**, let the GM edit before confirming. On confirm,
    emit the *existing* `actor:import-definition` with the reviewed `ActorDefinition`.
  - **Flag-and-degrade** (never silently accept ambiguous data): multiclass >4 classes → cap to 4
    + visible warning; a truncated `CLASS & LEVEL` field → recover from `=== <CLASS> FEATURES ===`
    headers + hit-dice breakdown, flagged; non-caster → no `spellcasting` block; companion stat
    blocks / appearance prose → `notes`/`extensions`, not core combat fields.
  - Best-effort **SRD content-id resolution**: map extracted spell names to the vendored
    `content:spells` ids (and equipment to `content:equipment`) so imported spells link to the
    reference popover and are castable; unmatched names keep a slug + a "homebrew/unmatched" flag.
  - **Golden-fixture tests**: the 6 proven fixtures (Cleric 5, Bard 20, Warlock 20, Fighter 20,
    Wizard 20, 6-class multiclass) → each `ActorDefinitionSchema.parse()`-valid + key-field
    assertions, regression-locked.
- **Out (deferred follow-ups):**
  - The **2014** (pre-2024) DDB layout — detect and reject with a clear message.
  - **Player-initiated** upload + a GM approval queue (v1 is GM-initiated; see Assumptions).
  - Scanned / image-only PDFs (OCR); companion creatures as first-class combatants; mixed
    multiclass **spell abilities** beyond the schema's single `spellcasting.ability` (v1 picks the
    highest-level caster's ability + relies on the DC/attack overrides).
  - The **D&D Beyond JSON** on-ramp (a separate, parallel importer — different source, same target).
  - Full equipment *mechanical* linking (weapon/armor stat blocks) beyond name/qty/weight.

## Relevant context (read this session)
- `docs/adr/0018-character-sheet-pdf-ingestion.md` — the governing ADR. **Needs amendment**: it
  assumed a *server-side* sandboxed worker (MarkItDown/Python); this packet does **client-side**
  in-browser extraction (the PDF never leaves the device — strictly more private, and no Python
  runtime). Its review-before-authorize and golden-fixture requirements still hold.
- `docs/adr/0021-player-character-sheet.md` + `docs/product/character-sheet-initiative.md` — the
  selection-field "no-rewrite" contract is the concrete import target; this is the Phase-1.5 fast-follow.
- `packages/schemas/src/index.ts` — `ActorDefinitionSchema` (`.max(4)` on `classes`; single
  `spellcasting.ability`) is the exact validation contract the draft must satisfy.
- POC (reference only, in scratchpad — not committed): `extract_poc.py` is the algorithm to port;
  6/6 fixtures already validate against the real schema via `tsx` + a copy of the schema.

## Existing implementation (reuse / extend, do not duplicate)
- `apps/server/src/actor-roster.ts` — `importActorDefinition` (the `actor:import-definition`
  handler) + `instantiate()` already seed live `spellSlots`/`pactSlots`/`preparedSpellIds`/
  `inventory`/`currency` from a definition. **Reuse as-is — no new server command.**
- `apps/client/src/actors/ActorRoster.tsx` — `importSheet(file)` already reads a JSON file and
  emits `actor:import-definition` (GM-only, `accept=".json"`). **Extend** with a PDF path + the
  review step; keep the JSON path.
- `apps/server/test/actor-import.test.ts` — existing import coverage to extend.
- `apps/server/src/content-library.ts` + `content:spells`/`content:equipment` — the SRD source of
  truth for name→id resolution.

## Constraints
- **Server authority holds.** Client-side extraction is a *convenience*; the server still runs the
  definition through `ActorDefinitionSchema` and the normal import authorization — client output is
  never trusted, only validated.
- **Viewer safety unchanged.** Imports flow into `definitions[]` (owner-only projection already);
  no projection/viewer change. The existing definition-leak tests must stay green.
- **Privacy / LAN.** The PDF is parsed in-browser and never uploaded (amends ADR-0018).
- **Determinism.** Version-pin `pdfjs-dist`; extraction is pure and golden-fixture-tested; same PDF →
  same output. No network, no LLM.
- **Fixtures & open-source (ADR-0017).** The sample PDFs carry a real handle (`Garrett_DM`) and real
  character data — **do not commit them as-is.** Commit sanitized/dummy-generated PDFs, or keep source
  PDFs in a local/gitignored fixtures path and commit the expected-JSON snapshots as the oracle.
- **Branch:** develop on `claude/dndbeyond-sheet-importer-0k6u2e`.

## Acceptance criteria
- [ ] Each of the 6 fixtures extracts to a draft that `ActorDefinitionSchema.parse()` accepts.
- [ ] Spot-checked field accuracy: Wizard 20 → INT 21, AC 12, HP 122, slots `4/3/3/3/3/2/2/1/1`,
      228 spells; Fighter 20 → **no** `spellcasting`; multiclass → classes capped at 4 **with a
      visible truncation warning**; every fixture recovers exactly its class's 2 save proficiencies
      and its expertise vs proficient skills.
- [ ] The review UI lists extracted values + warnings, the GM can edit any field, and confirming
      makes the character **claimable** via the existing flow; opening its sheet shows the imported
      spells/slots/inventory/currency.
- [ ] Reusing `actor:import-definition`: a second player and the viewer never receive the imported
      definition (existing projection-leak tests still green).
- [ ] An unsupported PDF (2014 layout / non-DDB / scanned) is rejected with an actionable message,
      not a silent partial import.
- [ ] **Roles:** GM-initiated in v1 (mirrors JSON import); player and viewer behavior unchanged.
- [ ] **Mobile/narrow:** the review UI is usable at 375px with touch.

## Verification
- **Quick checks:** `npm run check`, `npm run test`.
- **Fixture tests (new):** each of the 6 PDFs → `ActorDefinitionSchema`-valid + key-field assertions
  (the regression oracle); run in the extractor package's vitest (`pdfjs-dist` legacy build works in Node).
- **Browser:** `npm run dev`; as GM, import a fixture PDF, review, confirm, claim the character, open
  the sheet, cast a spell / spend a slot — the imported data drives it.
- **Mobile/narrow:** repeat the review + confirm at 375px.
- **Regression:** full server suite; confirm the definition-leak test is green.

## Files/docs to update
- **Product code:** new `packages/dndbeyond-pdf/` (pure extractor + fixtures + vitest) consumed by a
  new `apps/client/src/pdfImport/` (extractor glue + review UI); extend
  `apps/client/src/actors/ActorRoster.tsx` (PDF entry point beside JSON).
- **Tests:** `packages/dndbeyond-pdf/test/*` (golden fixtures); extend `apps/server/test/actor-import.test.ts`.
- **Fixtures:** sanitized PDFs or expected-JSON snapshots (see Constraints).
- **Project memory / docs:** amend `docs/adr/0018-*` (client-side extraction, accepted);
  `docs/product/character-sheet-initiative.md` (Phase 1.5 status); `BUILD_PLAN.md`;
  `docs/ai-ledger/{current-state,decision-log}.md`.

## Assumptions and open questions
- **Assumption (flag for sign-off):** client-side `pdfjs-dist` extraction, PDF never uploaded,
  reusing `actor:import-definition` — and **ADR-0018 is amended** to record this departure from its
  server-worker proposal. *(Strong recommendation; reversible to a server worker later.)*
- **Assumption (flag for sign-off):** v1 is **GM-initiated** import (matches today's JSON flow);
  player-upload → GM-approval queue is the follow-up (ADR-0018's model).
- **Assumption:** 2024 DDB layout only; others detected and rejected.
- **Open question (material):** confirm the two flagged decisions above. Everything else is settled by
  the POC + the existing import path.

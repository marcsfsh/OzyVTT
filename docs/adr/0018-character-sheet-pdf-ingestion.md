# ADR-018: Character-sheet PDF ingestion

- Status: Accepted (amended 2026-07-26 — see Amendment)
- Date: 2026-07-15

## Context

Players often already have completed character sheets as PDFs but not canonical VTT JSON. The VTT should let them bring that existing character without becoming a character builder or requiring manual JSON authoring. PDFs and extracted Markdown are untrusted, layout-dependent inputs, and MarkItDown adds a non-TypeScript runtime/packaging and security boundary.

## Decision drivers

- Preserve canonical versioned character JSON as the only durable actor-definition contract.
- Keep character creation and level-up choices outside the VTT.
- Make supported completed sheets accessible to nontechnical players on phone and desktop.
- Never silently convert ambiguous extraction into authoritative combat data.
- Keep private sheets local by default and prevent document processing from degrading or compromising live play.
- Keep extraction/conversion deterministic, diagnosable, versioned, and testable.

## Considered options

- Direct PDF-to-live-actor conversion: rejected because it bypasses review, canonical validation, and provenance.
- Make PDF a second durable actor format: rejected because every combat feature would need to understand document layout artifacts.
- Hosted AI document conversion: rejected as the default because it changes privacy, availability, cost, determinism, and self-hosting guarantees.
- Local MarkItDown extraction followed by a VTT-owned converter and review: current direction.

## Proposed decision

Use a version-pinned local MarkItDown adapter to extract a completed PDF into inert Markdown inside an isolated, no-network, resource-limited temporary worker. Feed that Markdown to a VTT-owned deterministic converter that produces field candidates with provenance, confidence, warnings, and unresolved alternatives. Normalize candidates into a draft canonical `actor-character` JSON document, validate it with the normal schema, and require review of ambiguous/required fields before authorized creation or update.

The original PDF, Markdown, and draft remain import-job artifacts, not live domain state. A player may upload and review; GM approval is the conservative initial policy for adding/updating a shared actor. Scanned/image-only sheets are explicitly unsupported until a separate bounded offline OCR decision is accepted.

## Consequences and tradeoffs

- Players can use existing sheets without learning JSON.
- The canonical importer, actor model, and combat domain remain unchanged.
- Packaging gains a MarkItDown/Python or equivalent worker dependency that must be solved for supported hosts.
- Layout coverage is incremental; unsupported sheets need actionable warnings and manual correction.
- Golden fixtures and version pins are required because extraction behavior may drift independently of VTT code.
- Review adds a step but prevents incorrect combat data from being silently accepted.

## Mobile impact

Phone users must be able to select/upload a PDF, see job progress, correct required fields, save/resume review, and understand failures. Dense source comparison may use a field-focused review rather than a full side-by-side PDF layout on narrow screens.

## Security and privacy impact

PDFs, extracted Markdown, embedded content, filenames, and converter output are untrusted. Extraction must have no network, least filesystem privilege, bounded input/page/output/CPU/memory/time, cleanup, and no access to auth secrets, the database, or game asset tree. Raw documents and host paths are redacted from ordinary logs/API responses. Retention/deletion is explicit; no hosted processing occurs without a later opt-in privacy decision.

## Migration and reversibility

The adapter is additive. Removing or replacing MarkItDown does not invalidate approved actors because only canonical JSON persists as the actor definition. Import jobs record extractor/converter versions so drafts can be reprocessed deliberately.

## Validation evidence required before acceptance

- Representative digital, table-heavy, multi-page, malformed, encrypted, scanned, and adversarial PDF spike.
- Runtime/memory/output and self-host packaging results on supported host targets.
- Deterministic golden conversions with field provenance and visible ambiguity.
- Isolation, cleanup, timeout/crash, no-network, and secret/path-redaction tests.
- Uncoached phone and desktop import/review usability test.

## Amendment (2026-07-26): accepted, with **client-side** extraction

Phase 1.5 ships as `packages/dndbeyond-pdf` + a GM review modal. Two departures from the
original proposal, both validated by a working extractor over six fixtures (Cleric 5, Bard 20,
Warlock 20, Fighter 20, Wizard 20, a 6-class multiclass — all validate against `ActorDefinitionSchema`):

- **Extraction runs in the browser, not a server worker.** D&D Beyond's PDF export is a *named
  AcroForm*: every character value is a widget (`/T` field name + `/V` value), so extraction is a
  deterministic field-name → schema mapping via `pdfjs-dist` (Apache-2.0; worker bundled locally,
  no CDN) — no MarkItDown/Python worker, and the PDF never leaves the device (strictly more private
  than the proposed sandbox). This removes the packaging/isolation burden the original decision
  carried. The server still re-validates every definition through `ActorDefinitionSchema` and applies
  the normal import authorization, so server authority is unchanged.
- **Reuses the existing import path.** The reviewed draft flows through the existing
  `actor:import-definition` command; no new server surface.

Kept from the proposal: draft → GM review before authorized creation; deterministic,
golden-fixture-tested extraction; never silently convert ambiguous data (flag-and-degrade, e.g.
a >4-class multiclass caps to 4 with a warning); and 2024-layout scope (others detected/rejected).
Deferred: player-initiated upload + a GM approval queue (v1 is GM-initiated), the 2014 sheet layout,
scanned/OCR, and the D&D Beyond JSON on-ramp (a separate importer, same target). The original
MarkItDown/worker option remains the fallback if a non-AcroForm export ever appears.

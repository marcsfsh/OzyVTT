# ADR-017: Open-source distribution and governance

## Status

Proposed — 2026-07-15.

## Context and decision drivers

The project is intended to become publicly available for self-hosting and outside integration/contribution. Application code, SRD-derived content, user/import fixtures, artwork, documentation, dependencies, and community contributions may have different licensing/provenance requirements. Public releases also need predictable security, support, compatibility, and release practices that remain manageable for a small maintainer base.

## Considered options

- Source-visible without an open-source license: conflicts with the stated openness goal and leaves reuse/contribution unclear.
- Copyleft application license: preserves downstream sharing obligations but may reduce some integration/adoption paths.
- Permissive OSI-approved application license: maximizes reuse/integration, while requiring separate handling for content/assets and clear project governance.
- One license for the entire repository: simple-looking but unsafe where code, SRD-derived material, examples, and art have different provenance.

## Proposed direction

Use an approved open-source license for application code, with a permissive license as the starting candidate pending review. Record separate licenses/notices and provenance for curated content, examples, documentation, and assets. Decide DCO versus CLA before accepting contributions.

Before public launch, add contribution, code of conduct, security, support, governance, compatibility, and release policies; sanitize history/artifacts; inventory dependency/content licenses; and produce reproducible tagged self-host releases with checksums, migration notes, and an SBOM/provenance record where practical.

## Consequences and tradeoffs

Public distribution adds review, support, security-response, and compatibility work. Clear boundaries reduce accidental licensing/private-data leaks and set expectations for community integrations without obligating the maintainer to support every platform or SDK.

## Mobile, security, and visibility impact

No telemetry is enabled by default. Public fixtures/logs/screenshots must contain no campaign secrets, credentials, personal paths, or identifiers. Self-host documentation must explain trusted-LAN versus internet exposure, TLS/proxy/VPN choices, backups, permissions, and token rotation.

## Migration / reversibility

Do not accept outside contributions or publish a stable public release until license/contribution terms are settled. Changing license terms later may require consent from copyright holders, so this decision must be made deliberately before the contributor base expands.

## Validation evidence required for acceptance

A clean public-release audit confirms explicit licenses/notices for every material class, contributor policy, security/reporting path, support matrix, sanitized history/artifacts, dependency/content provenance inventory, reproducible build/release instructions, checksums/migration notes, and no embedded private data or secrets.

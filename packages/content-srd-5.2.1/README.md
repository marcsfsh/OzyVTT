# SRD 5.2.1 content bundles

Curated, offline SRD 5.2.1 content (CC BY 4.0) as canonical, schema-validated JSON — the
content boundary described in ADR-0007/ADR-0015. Nothing here is executable; bundles are
data that `@vtt/schemas` validates before anything consumes it.

## Layout

- `sources/open5e-srd-2024/` — vendored, unmodified [open5e-api](https://github.com/open5e/open5e-api)
  Django fixtures for the `srd-2024` document (CC BY 4.0 — the only document vendored;
  third-party/OGL sources are deliberately excluded).
- `scripts/build-bundle.ts` — the ETL/adapter. Joins Creature + CreatureAction +
  CreatureActionAttack + CreatureTrait and adapts each stat block into a canonical
  `ActorDefinition` (structured attacks/saves/damage; everything unmodeled stays inert in
  `extensions`/description text per ADR-0008). Deterministic output; refuses to write if any
  record fails validation. Re-run with `npm run build-bundle -w @vtt/content-srd-5.2.1`.
- `bundles/` — the committed, reviewed bundles:
  - `monsters.v1.json` — all 331 SRD 5.2.1 monsters as `ActorDefinition` v1.
  - `conditions.v1.json` — the 15 SRD conditions as reference text.
  - `attribution.json` — the required CC BY 4.0 attribution; any surface that displays this
    content must show it.
- `src/index.ts` — typed, validated loaders (`loadMonsterDefinitions`, `loadConditions`,
  `loadAttribution`). Server-side only: clients receive content via server projections, never
  by importing this package.

## License

Game content: **CC BY 4.0** — "This work includes material from the System Reference Document
5.2.1 ('SRD 5.2.1') by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd.
The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License."
The vendored fixture *files* come from open5e-api, whose code is MIT; the fixtures carry the
SRD's own license per open5e's `Document`/`License` model.

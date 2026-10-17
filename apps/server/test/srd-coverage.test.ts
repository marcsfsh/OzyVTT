import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadClasses,
  loadConditions,
  loadEquipment,
  loadFeats,
  loadGlossary,
  loadMonsterDefinitions,
  loadSpecies,
  loadSpells,
  loadSubclasses
} from "@vtt/content-srd-5.2.1";
import { renderSrdCoverage, srdCoverageRows, traitKind } from "../src/srd-coverage.js";
import {
  CONDITION_COVERAGE,
  GLOSSARY_COVERAGE,
  MONSTER_TRAIT_COVERAGE,
  RECORD_OVERRIDES
} from "../src/srd-coverage-curated.js";

describe("the SRD coverage manifest", () => {
  it("matches the committed docs/srd-coverage.md exactly (regenerate with `npm run map`)", () => {
    const committed = readFileSync(fileURLToPath(new URL("../../../docs/srd-coverage.md", import.meta.url)), "utf8");
    expect(committed).toBe(renderSrdCoverage());
  });

  it("classifies every condition, glossary entry and monster trait kind, saying how", () => {
    const unclassified = srdCoverageRows().filter((row) => row.note === "not classified");
    expect(unclassified.map((row) => `${row.group}: ${row.id}`)).toEqual([]);
    for (const curated of [CONDITION_COVERAGE, GLOSSARY_COVERAGE, MONSTER_TRAIT_COVERAGE, RECORD_OVERRIDES])
      for (const [key, row] of Object.entries(curated)) expect(row.note.trim(), key).not.toBe("");
  });

  it("names only records that exist, so a renamed record can't keep a stale row", () => {
    const conditions = new Set(loadConditions().map((condition) => condition.id));
    expect(Object.keys(CONDITION_COVERAGE).filter((id) => !conditions.has(id))).toEqual([]);
    const glossary = new Set(loadGlossary().map((entry) => entry.id));
    expect(Object.keys(GLOSSARY_COVERAGE).filter((id) => !glossary.has(id))).toEqual([]);
    const kinds = new Set(
      loadMonsterDefinitions().flatMap((definition) =>
        ((definition.extensions["open5e.srd-2024"] as { traits?: { name: string }[] } | undefined)?.traits ?? []).map(
          (trait) => traitKind(trait.name)
        )
      )
    );
    expect(Object.keys(MONSTER_TRAIT_COVERAGE).filter((kind) => !kinds.has(kind))).toEqual([]);
    const features = [
      ...loadClasses().flatMap((record) => record.features),
      ...loadSubclasses().flatMap((record) => record.features),
      ...loadSpecies().flatMap((species) => [...species.traits, ...species.lineages.flatMap((line) => line.traits)]),
      ...loadFeats().map((feat) => feat.feature)
    ];
    const keys = new Set([
      ...loadSpells().map((spell) => `spell:${spell.id}`),
      ...features.map((feature) => `feature:${feature.id}`),
      ...loadEquipment().map((item) => `item:${item.id}`),
      ...loadMonsterDefinitions().flatMap((definition) =>
        definition.actions.map((action) => `action:${definition.name}/${action.id}`)
      )
    ]);
    expect(Object.keys(RECORD_OVERRIDES).filter((key) => !keys.has(key))).toEqual([]);
  });
});

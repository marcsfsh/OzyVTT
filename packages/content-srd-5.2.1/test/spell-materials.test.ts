import { describe, expect, it } from "vitest";
import { loadEquipment, loadSpells } from "../src/index.js";
import { SPELL_MATERIAL_IDS } from "../scripts/spell-materials.js";

// SRD 5.2.1 "Components": a Component Pouch or a Spellcasting Focus stands in for a Material component, "but if a
// cost is indicated for a component, a character must have that specific component", and one the spell consumes is
// used up. The bundle carries those materials as data, so the server checks them without reading the card.

const spells = loadSpells();
const spell = (id: string) => spells.find((record) => record.id === id)!;
const worth = (text: string) =>
  [...text.matchAll(/([\d,]+)\+?\s*GP/gi)].map((match) => Number(match[1]!.replace(/,/g, "")));

describe("a spell's priced and consumed materials", () => {
  it("names only real spells", () => {
    const ids = new Set(spells.map((record) => record.id));
    expect(SPELL_MATERIAL_IDS.filter((id) => !ids.has(id))).toEqual([]);
  });

  it("gives a row to every material the card prices or the spell consumes", () => {
    const missing = spells
      .filter(
        (record) =>
          record.components.material &&
          (record.components.materialConsumed === true || /\bGP\b/.test(record.components.materialText ?? "")) &&
          !record.components.costly
      )
      .map((record) => record.id);
    expect(missing).toEqual([]);
  });

  it("prices each row as the card does", () => {
    for (const record of spells) {
      for (const material of record.components.costly ?? []) {
        if (material.costGp === null) continue;
        expect(worth(record.components.materialText ?? ""), `${record.id}: ${material.name}`).toContain(
          material.costGp
        );
      }
    }
  });

  it("marks a row consumed only when the spell consumes its material", () => {
    expect(spell("revivify").components.costly).toEqual([
      { name: "diamond", matches: ["diamond"], costGp: 300, consumed: true }
    ]);
    expect(spell("identify").components.costly?.[0]).toMatchObject({ name: "pearl", costGp: 100, consumed: false });
    expect(spell("gentle-repose").components.costly?.[0]).toMatchObject({
      consumed: true,
      coins: { unit: "cp", amount: 2 }
    });
  });

  it("points at gear the equipment list holds", () => {
    const gear = new Set(loadEquipment().map((item) => item.id));
    const named = spells.flatMap((record) => (record.components.costly ?? []).flatMap((row) => row.itemIds ?? []));
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((id) => !gear.has(id))).toEqual([]);
  });
});

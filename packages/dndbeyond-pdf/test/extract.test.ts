import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { buildDefinition } from "../src/extract.js";
import { readWidgets, type Widget } from "../src/read-pdf.js";

const here = dirname(fileURLToPath(import.meta.url));
const widgetsOf = (name: string): Widget[] => JSON.parse(readFileSync(join(here, "fixtures", `${name}.widgets.json`), "utf8"));
const importFixture = (name: string) => {
  const { draft, warnings } = buildDefinition(widgetsOf(name));
  return { draft, warnings, parsed: ActorDefinitionSchema.safeParse(draft) };
};

const FIXTURES = ["cleric5", "bard20", "warlock20", "fighter20", "wizard20", "multiclass"];

describe("D&D Beyond PDF import — golden fixtures (recorded widgets)", () => {
  for (const f of FIXTURES) {
    it(`${f} → valid ActorDefinition`, () => {
      const { parsed } = importFixture(f);
      if (!parsed.success) console.error(f, JSON.stringify(parsed.error.issues.slice(0, 12), null, 2));
      expect(parsed.success).toBe(true);
    });
  }

  it("wizard20: key fields extracted correctly", () => {
    const { parsed } = importFixture("wizard20");
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const d = parsed.data;
    expect(d.name).toBe("Zhen");
    expect(d.character?.classes).toEqual([{ id: "wizard", name: "Wizard", level: 20 }]);
    expect(d.abilityScores).toEqual({ str: 8, dex: 14, con: 14, int: 21, wis: 14, cha: 10 });
    expect(d.armorClass).toBe(12);
    expect(d.hitPoints.maximum).toBe(122);
    expect(d.spellcasting?.ability).toBe("int");
    expect(d.spellcasting?.saveDc).toBe(19);
    expect(d.spellcasting?.slots.map((s) => s.max)).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
    expect(d.spellcasting?.spells.length ?? 0).toBeGreaterThan(200);
    expect(d.proficiencies?.skills).toContainEqual({ id: "arcana", proficiency: "expertise" });
    expect(d.startingInventory?.length ?? 0).toBeGreaterThan(10);
  });

  it("spell ids are SRD-style slugs; ritual tags and apostrophes normalized", () => {
    const wiz = importFixture("wizard20");
    expect(wiz.parsed.success).toBe(true);
    if (!wiz.parsed.success) return;
    const ids = wiz.parsed.data.spellcasting!.spells.map((s) => s.id);
    expect(ids).toContain("ray-of-frost");
    expect(ids).toContain("fireball");
    expect(ids.every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true);
    // warlock's "Detect Magic [R]" must become "detect-magic", not "detect-magic-r"
    const war = importFixture("warlock20");
    if (war.parsed.success) {
      const wids = war.parsed.data.spellcasting!.spells.map((s) => s.id);
      expect(wids).toContain("detect-magic");
      expect(wids.some((id) => /-r$|-c$/.test(id))).toBe(false);
    }
  });

  it("flags spells not in the provided SRD id set", () => {
    const { warnings } = buildDefinition(widgetsOf("wizard20"), { knownSpellIds: new Set(["ray-of-frost"]) });
    expect(warnings.some((w) => /SRD list/i.test(w))).toBe(true);
  });

  it("fighter20: non-caster has no spellcasting block", () => {
    const { parsed } = importFixture("fighter20");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.spellcasting).toBeUndefined();
  });

  it("cleric5: recovers the two class save proficiencies", () => {
    const { parsed } = importFixture("cleric5");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect([...(parsed.data.proficiencies?.saves ?? [])].sort()).toEqual(["cha", "wis"]);
  });

  it("multiclass: classes capped at 4 with a warning (flag-and-degrade)", () => {
    const { warnings, parsed } = importFixture("multiclass");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.character?.classes.length).toBe(4);
    expect(warnings.some((w) => /class/i.test(w))).toBe(true);
  });
});

// Full pdfjs pipeline — runs only when the source PDFs are present locally (they are gitignored).
describe("pdf pipeline (optional, needs local source PDFs)", () => {
  const pdf = join(here, "fixtures", "wizard20.pdf");
  it.skipIf(!existsSync(pdf))("readWidgets(PDF) reproduces the recorded widget count", async () => {
    const live = await readWidgets(new Uint8Array(readFileSync(pdf)));
    expect(live.length).toBe(widgetsOf("wizard20").length);
  });
});

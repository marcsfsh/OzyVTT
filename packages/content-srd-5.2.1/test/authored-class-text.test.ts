import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadClasses, loadSubclasses, type FeatureRecord } from "../src/index.js";

// The Cleric, Fighter and Wizard and their subclasses are hand-authored for their mechanics; their features read as
// SRD 5.2.1 prints them. Each feature with a heading of its own name in the source opens with the source's words.

const SOURCE = readFileSync(join(import.meta.dirname, "../sources/dnd-5e-srd-markdown/classes.md"), "utf8");

/** A section's opening words, with the markup and spacing the bundle drops. */
function openingOf(className: string, featureName: string): string | null {
  const section = SOURCE.split(/^## /m).find((part) => part.startsWith(`${className}\n`));
  const escaped = featureName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = section ? new RegExp(`^#### (?:Level \\d+: )?${escaped}\\s*$`, "m").exec(section) : null;
  if (!section || !match) return null;
  const body = section.slice(match.index + match[0].length).split(/^#{3,4} /m)[0];
  return body.replace(/[*_]/g, "").replace(/\s+/g, " ").replace(/[‘’]/g, "'").trim().slice(0, 60);
}

const AUTHORED: ReadonlyArray<readonly [string, string, readonly FeatureRecord[]]> = [
  ...["cleric", "fighter", "wizard"].map(
    (id) =>
      [
        id,
        loadClasses().find((record) => record.id === id)!.name,
        loadClasses().find((record) => record.id === id)!.features
      ] as const
  ),
  ...(
    [
      ["life-domain", "Cleric"],
      ["champion", "Fighter"],
      ["evoker", "Wizard"]
    ] as const
  ).map(([id, className]) => [id, className, loadSubclasses().find((record) => record.id === id)!.features] as const)
];

describe("the hand-authored classes' text", () => {
  it("opens each feature with the SRD's own words", () => {
    let compared = 0;
    for (const [id, className, features] of AUTHORED) {
      for (const feature of features) {
        const opening = openingOf(className, feature.name);
        if (opening === null) continue;
        compared += 1;
        expect(feature.description.replace(/[‘’]/g, "'"), `${id}.${feature.id}`).toContain(opening);
      }
    }
    expect(compared).toBeGreaterThan(30);
  });

  it("keeps the rules the authored text cut", () => {
    const feature = (records: readonly FeatureRecord[], id: string) => records.find((entry) => entry.id === id)!;
    const wizard = loadClasses().find((record) => record.id === "wizard")!.features;
    const fighter = loadClasses().find((record) => record.id === "fighter")!.features;
    const evoker = loadSubclasses().find((record) => record.id === "evoker")!.features;
    expect(feature(wizard, "spellcasting").description.length).toBeGreaterThan(2500);
    expect(feature(wizard, "spellcasting").description).toContain("Spellbook");
    expect(feature(evoker, "overchannel").description).toContain("Necrotic damage");
    expect(feature(evoker, "evocation-savant").description).toContain("whenever you gain access to a new level");
    expect(feature(evoker, "potent-cantrip").description).toContain("miss with the attack roll");
    expect(feature(fighter, "second-wind").description).toContain("You can use this feature twice");
    expect(feature(fighter, "indomitable").description).toContain("can't use this feature again");
  });
});

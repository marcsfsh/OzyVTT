import { describe, expect, it } from "vitest";
import type { FieldDef } from "./schema";
import { SCHEMAS } from "./schemas";

// Armor of Vulnerability's curse is a switch shown only while the item is cursed and the GM picks its resistance from
// a choice. Hiding the switch clears it, so a draft never carries a curse the editor no longer shows.

function field(key: string): FieldDef {
  const walk = (fields: readonly FieldDef[]): FieldDef | undefined =>
    fields.reduce<FieldDef | undefined>(
      (found, candidate) =>
        found ?? (candidate.key === key ? candidate : candidate.rows ? walk(candidate.rows) : undefined),
      undefined
    );
  const found = SCHEMAS.equipment.sections.map((section) => walk(section.fields)).find(Boolean);
  if (!found) throw new Error(`No equipment field ${key}`);
  return found;
}

const ARMOR = {
  isMagic: true,
  attunement: { required: true },
  cursed: true,
  damageTypeChoice: ["fire", "cold", "lightning"],
  vulnerableToOtherChoices: true
};

describe("the homebrew curse switch", () => {
  it("is cleared when the item stops being cursed", () => {
    const written = field("cursed").write!(false, ARMOR);
    expect(written).toMatchObject({ cursed: false });
    expect(written).not.toHaveProperty("vulnerableToOtherChoices");
    expect(field("cursed").write!(true, written)).toMatchObject({ cursed: true });
  });

  it("is cleared when the GM's choice of types is emptied", () => {
    const written = field("damageTypeChoice").write!([], ARMOR);
    expect(written).not.toHaveProperty("damageTypeChoice");
    expect(written).not.toHaveProperty("vulnerableToOtherChoices");
    expect(field("damageTypeChoice").write!(["fire", "cold"], ARMOR)).toMatchObject({
      vulnerableToOtherChoices: true
    });
  });
});

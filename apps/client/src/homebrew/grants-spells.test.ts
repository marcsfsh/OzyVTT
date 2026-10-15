import { describe, expect, it } from "vitest";
import { grantRowsOf, grantsFromRows } from "./riders/GrantsEditor";

/** A grant authored through the API with the details the editor's id-only row cannot show. */
const AUTHORED = {
  spells: [
    { id: "misty-step", level: 2, ability: "cha", alwaysPrepared: false },
    { id: "hex", alwaysPrepared: true }
  ],
  damageResistances: ["necrotic"]
};

describe("editing a grants block", () => {
  it("keeps each granted spell's level, ability and alwaysPrepared when another row changes", () => {
    const rows = grantRowsOf(AUTHORED).map((row) =>
      row.kind === "damageResistances" ? { ...row, values: ["necrotic", "cold"] } : row
    );
    expect(grantsFromRows(rows, AUTHORED)).toEqual({
      spells: AUTHORED.spells,
      damageResistances: ["necrotic", "cold"]
    });
  });

  it("changes only the id list: a removed spell goes, an added one starts always prepared", () => {
    const rows = grantRowsOf(AUTHORED).map((row) =>
      row.kind === "spells" ? { ...row, values: ["misty-step", "shield"] } : row
    );
    expect(grantsFromRows(rows, AUTHORED)?.spells).toEqual([
      { id: "misty-step", level: 2, ability: "cha", alwaysPrepared: false },
      { id: "shield", alwaysPrepared: true }
    ]);
  });
});

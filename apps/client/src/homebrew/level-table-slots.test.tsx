import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { spellSlotsForClass } from "@vtt/rules-5e";
import { LevelTableEditor } from "./LevelTableEditor";
import { blankLevelTable } from "./defaults";
import type { Draft } from "./schema";

describe("the class level table's slots", () => {
  it("gives a blank class picked as a full caster the full caster's slots", () => {
    // The Spellcasting step sets the progression while the table is not mounted, so the table first meets a class
    // that already casts and rows with no slots column at all.
    const draft: Draft = {
      name: "Tidecaller",
      spellcasting: { ability: "wis", multiclassProgression: "full" },
      levelTable: blankLevelTable()
    };
    const onDraft = vi.fn();
    render(<LevelTableEditor draft={draft} onDraft={onDraft} classId="hb-tidecaller-a1b2c3" />);
    expect(onDraft).toHaveBeenCalled();
    const rows = (onDraft.mock.calls.at(-1)![0] as { levelTable: Array<{ spellSlots?: number[] }> }).levelTable;
    expect(rows[0].spellSlots).toEqual([...spellSlotsForClass("hb-tidecaller-a1b2c3", 1, "full")]);
    expect(rows[0].spellSlots![0]).toBe(2);
    expect(rows[4].spellSlots!.slice(0, 3)).toEqual([4, 3, 2]);
  });

  it("keeps a row the GM overrode", () => {
    const table = blankLevelTable().map((row) => ({
      ...row,
      spellSlots: [...spellSlotsForClass("x", row.level, "full")]
    }));
    table[0] = { ...table[0], spellSlots: [3, 0, 0, 0, 0, 0, 0, 0, 0] };
    const draft: Draft = { spellcasting: { ability: "int", multiclassProgression: "full" }, levelTable: table };
    const onDraft = vi.fn();
    render(<LevelTableEditor draft={draft} onDraft={onDraft} classId="x" />);
    const written = onDraft.mock.calls.at(-1)?.[0] as { levelTable: Array<{ spellSlots?: number[] }> } | undefined;
    expect((written?.levelTable ?? table)[0].spellSlots).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

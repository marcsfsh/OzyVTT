import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { HomebrewTableColumns } from "@vtt/api-contract";
import { FilterPanel } from "./FilterPanel";
import {
  NO_FILTERS,
  facetCounts,
  readTableFilters,
  spanOf,
  valuesBetween,
  writeTableFilters,
  type CompendiumRow,
  type TableFilters
} from "./tableModel";

// Browse's filter panel (compendium spec 2.2): counts that let their own facet go, the CR range written as the
// values between its ends, the folded rows and Clear.

const monster = (id: string, cr: number, type: string, size = "medium", source: "srd" | "homebrew" = "srd") =>
  ({
    id,
    kind: "monster",
    name: id,
    source,
    packId: source === "srd" ? null : "table",
    state: "published",
    audience: "everyone",
    columns: { challengeRating: cr, creatureType: type, size } as HomebrewTableColumns
  }) as CompendiumRow;
const ROWS = [
  monster("goblin", 0.25, "humanoid", "small"),
  monster("orc", 0.5, "humanoid"),
  monster("wolf", 0.25, "beast"),
  monster("ogre", 2, "giant", "large"),
  monster("goblin-boss", 1, "humanoid", "small", "homebrew")
];
const SOURCES = [
  { value: "srd", label: "SRD 5.2.1" },
  { value: "table", label: "This table" }
];

describe("the facets' counts", () => {
  it("count each choice with every other filter as it is, letting their own facet go", () => {
    const filters: TableFilters = { ...NO_FILTERS, kind: { type: ["humanoid"] } };
    // Type lets itself go: every type counts.
    expect(Object.fromEntries(facetCounts(ROWS, filters, "monster", { type: "kind", key: "type" }))).toEqual({
      humanoid: 3,
      beast: 1,
      giant: 1
    });
    // Source keeps the type filter.
    expect(Object.fromEntries(facetCounts(ROWS, filters, "monster", { type: "source" }))).toEqual({ srd: 2, table: 1 });
  });
});

describe("the range helpers", () => {
  const ordered = ["0.25", "0.5", "1", "2"];
  it("write every value between two ends, and read an older list's span", () => {
    expect(valuesBetween(ordered, "0.5", "2")).toEqual(["0.5", "1", "2"]);
    expect(spanOf(ordered, ["0.25", "2"])).toEqual(["0.25", "2"]);
    expect(spanOf(ordered, undefined)).toEqual(["0.25", "2"]);
  });

  it("keep the address's list form through a round trip", () => {
    const query = new URLSearchParams();
    writeTableFilters(query, { ...NO_FILTERS, kind: { cr: valuesBetween(ordered, "0.5", "1") } }, ["srd", "table"]);
    expect(query.get("f.cr")).toBe("0.5,1");
    expect(readTableFilters(query, "monster").kind.cr).toEqual(["0.5", "1"]);
  });
});

function Panel({
  initial = NO_FILTERS,
  spy
}: Readonly<{ initial?: TableFilters; spy?: (next: TableFilters) => void }>) {
  const [filters, setFilters] = useState(initial);
  return (
    <FilterPanel
      kind="monster"
      filters={filters}
      onFilters={(next) => {
        spy?.(next);
        setFilters(next);
      }}
      rows={ROWS}
      sources={SOURCES}
      gm
    />
  );
}

describe("the filter panel", () => {
  it("lists the type with counts and writes a CR range from its ends", () => {
    const spy = vi.fn();
    render(<Panel spy={spy} />);
    const types = screen.getByRole("group", { name: "Type" });
    expect(within(types).getByText("Humanoid").closest(".cp-fp-choice")).toHaveTextContent("3");
    fireEvent.change(screen.getByRole("combobox", { name: "From CR" }), { target: { value: "0.5" } });
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ kind: { cr: ["0.5", "1", "2"] } }));
  });

  it("folds Size, State and the rest as rows with their current value, and clears everything", () => {
    render(<Panel initial={{ ...NO_FILTERS, kind: { size: ["small"] } }} />);
    const fold = (name: string) =>
      [...document.querySelectorAll(".cp-fp-fold-name")]
        .find((label) => label.textContent === name)!
        .closest("details")!;
    const size = fold("Size");
    expect(size).toHaveTextContent("Small");
    expect(fold("Problems")).toHaveTextContent("Any");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(fold("Size")).toHaveTextContent("Any");
  });
});

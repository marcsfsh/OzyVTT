import { describe, expect, it } from "vitest";
import { NO_NAMES, phoneFacts } from "./kinds";
import { compendiumViewOf, recordPath, tablePath, withTableQuery } from "./routes";
import {
  NO_FILTERS,
  activeFilters,
  filterRows,
  readTableFilters,
  readTableSort,
  sortRows,
  tableSummary,
  writeTableFilters,
  type CompendiumRow
} from "./tableModel";

const view = (path: string) => {
  const [pathname, search = ""] = path.split("?");
  return compendiumViewOf(pathname!.split("/").filter(Boolean), new URLSearchParams(search));
};

const spell = (id: string, name: string, level: number, extra: Partial<CompendiumRow> = {}): CompendiumRow => ({
  id,
  kind: "spell",
  name,
  source: "srd",
  packId: null,
  // The GM's table reads an SRD row as published and shared with everyone.
  state: "published",
  archived: false,
  pendingChanges: false,
  audience: "everyone",
  characterIds: [],
  columns: {
    level,
    school: level === 3 ? "evocation" : "abjuration",
    castingTime: "action",
    range: "150 feet",
    lists: []
  },
  ...extra
});
const ROWS: readonly CompendiumRow[] = [
  spell("fireball", "Fireball", 3),
  spell("counterspell", "Counterspell", 3),
  spell("shield", "Shield", 1),
  spell("hb-brine-burst-a1b2c3", "Brine Burst", 3, {
    source: "homebrew",
    packId: "table",
    state: "published",
    pendingChanges: true,
    archived: false,
    audience: "characters",
    characterIds: ["lyra"],
    issueCount: 1,
    updatedAt: "2026-10-18T21:40:00.000Z"
  }),
  spell("hb-old-ward-d4e5f6", "Old Ward", 1, {
    source: "homebrew",
    packId: "table",
    state: "published",
    archived: true,
    audience: "hidden",
    characterIds: [],
    issueCount: 0,
    updatedAt: "2026-10-01T10:00:00.000Z"
  })
];

describe("the Compendium's addresses", () => {
  it("names every view and every record, and nothing else", () => {
    expect(view("/compendium")).toEqual({ view: "overview" });
    expect(view("/compendium/tables")).toEqual({ view: "tables", kind: null });
    expect(view("/compendium/tables/items")).toEqual({ view: "tables", kind: "equipment" });
    expect(view("/compendium/sources")).toEqual({ view: "sources" });
    expect(view("/compendium/sharing")).toEqual({ view: "sharing" });
    expect(view("/compendium/spells/fireball")).toEqual({ view: "record", kind: "spell", id: "fireball", tab: "card" });
    expect(view("/compendium/monsters/hb-m-1a2b?tab=history")).toMatchObject({ kind: "monster", tab: "history" });
    // An unknown tab reads as the card; an unknown kind or a deeper path names nothing.
    expect(view("/compendium/spells/fireball?tab=secrets")).toMatchObject({ tab: "card" });
    expect(view("/compendium/dragons/fireball")).toBeNull();
    expect(view("/compendium/tables/dragons")).toBeNull();
    expect(view("/compendium/spells/fireball/edit")).toBeNull();
    expect(view("/compendium/spells/Not An Id")).toBeNull();
  });

  it("keeps the table's filters when a record opens, and drops the record's own keys when it closes", () => {
    const query = new URLSearchParams("f.level=3&sort=level:asc&tab=history&step=effect&new=1");
    expect(withTableQuery(recordPath("spell", "fireball"), query, { tab: "edit" })).toBe(
      "/compendium/spells/fireball?f.level=3&sort=level%3Aasc&tab=edit"
    );
    expect(withTableQuery(tablePath("spell"), query)).toBe("/compendium/tables/spells?f.level=3&sort=level%3Aasc");
    expect(tablePath(null)).toBe("/compendium/tables");
  });
});

describe("a table's filters and sort, from the address", () => {
  it("reads and writes the same address, and keeps archived rows out until asked", () => {
    const query = new URLSearchParams();
    writeTableFilters(
      query,
      { ...NO_FILTERS, q: "burst", sources: ["table"], kind: { level: ["3"] }, problems: true },
      ["srd", "table"]
    );
    expect(query.toString()).toBe("q=burst&source=table&problems=1&f.level=3");
    const filters = readTableFilters(query, "spell");
    expect(filters).toMatchObject({ q: "burst", sources: ["table"], problems: true, kind: { level: ["3"] } });
    expect(activeFilters(filters)).toBe(3);
    // A player's table counts only what a player can filter on.
    expect(activeFilters({ ...filters, problems: false, states: ["draft"] }, false)).toBe(2);

    expect(filterRows(ROWS, NO_FILTERS, "spell").map((row) => row.id)).not.toContain("hb-old-ward-d4e5f6");
    expect(filterRows(ROWS, { ...NO_FILTERS, states: ["archived"] }, "spell").map((row) => row.name)).toEqual([
      "Old Ward"
    ]);
    expect(filterRows(ROWS, filters, "spell").map((row) => row.name)).toEqual(["Brine Burst"]);
    expect(filterRows(ROWS, { ...NO_FILTERS, sources: ["srd"] }, "spell")).toHaveLength(3);
    expect(filterRows(ROWS, { ...NO_FILTERS, audiences: ["characters"] }, "spell").map((row) => row.name)).toEqual([
      "Brine Burst"
    ]);
  });

  it("sorts by several columns in order, and says so over the table", () => {
    const query = new URLSearchParams("sort=level:asc,name:desc");
    const levels = readTableSort(query, "spell", true);
    expect(levels).toEqual([
      { key: "level", direction: "asc" },
      { key: "name", direction: "desc" }
    ]);
    const shown = sortRows(filterRows(ROWS, NO_FILTERS, "spell"), levels, "spell", NO_NAMES);
    expect(shown.map((row) => row.name)).toEqual(["Shield", "Fireball", "Counterspell", "Brine Burst"]);
    expect(
      tableSummary(shown.length, "spell", { ...NO_FILTERS, kind: { level: ["3"] } }, levels, {
        name: "Name",
        level: "Level"
      })
    ).toBe("Level 3 · 4 spells · sorted by Level, then Name");
    // A player's sort has no State or Problems to sort on.
    expect(readTableSort(new URLSearchParams("sort=problems:desc"), "spell", false)).toEqual([
      { key: "name", direction: "asc" }
    ]);
  });

  it("keeps a phone row to the two facts that matter for its kind", () => {
    expect(phoneFacts("spell", ROWS[0]!.columns, NO_NAMES)).toBe("Level 3 · Evocation · Action");
    expect(phoneFacts("monster", { challengeRating: 8, size: "medium", creatureType: "undead" }, NO_NAMES)).toBe(
      "CR 8 · Medium Undead"
    );
  });
});

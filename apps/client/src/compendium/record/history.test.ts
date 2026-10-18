import { describe, expect, it } from "vitest";
import type { HomebrewRevisionSummary } from "../../homebrew/api";
import { mergedDraft, mergeRows, defaultKeeps } from "./Merge";
import { defaultPicks, historyRows } from "./history";
import { compareBodies, diffWords } from "./words";

let next = 0;
const revision = (
  event: HomebrewRevisionSummary["event"],
  changedFields: string[] = [],
  extra: Partial<HomebrewRevisionSummary> = {}
): HomebrewRevisionSummary => {
  next += 1;
  return {
    id: next,
    rev: next,
    at: `2026-10-${String(10 + next).padStart(2, "0")}T20:00:00.000Z`,
    event,
    device: "this-device",
    deviceKey: "gm:a",
    name: "Tidecaller",
    state: event === "create" || event === "duplicate" ? "draft" : "published",
    pending: false,
    audience: "everyone",
    characterIds: [],
    changedFields,
    ...extra
  };
};

describe("a record's history as a table", () => {
  it("numbers each publish as a version and folds the edits between, the newest first", () => {
    next = 0;
    // The server lists history newest first.
    const list = [
      revision("duplicate", ["name"]),
      revision("edit", ["summary"]),
      revision("publish"),
      revision("share"),
      revision("edit", ["features"], { device: "other-device", deviceKey: "gm:b" }),
      revision("edit", ["summary"]),
      revision("publish", ["features", "summary"]),
      revision("edit", ["summary"], { pending: true }),
      revision("edit", ["features"], { pending: true })
    ].reverse();
    const rows = historyRows(list, "class");
    expect(rows.map((row) => row.label)).toEqual([
      "Changes not live",
      "Version 2",
      "2 edits",
      "Who sees it",
      "Version 1",
      "2 edits"
    ]);
    expect(rows[0]).toMatchObject({ notLive: true, edits: 2 });
    expect(rows[0]!.changed).toEqual(["Summary", "Class features"]);
    // Two devices wrote the edits between the versions.
    expect(rows[2]).toMatchObject({ devices: 2 });
    expect(rows[3]).toMatchObject({ revisionId: null, changed: ["Who sees it: Everyone"] });
    expect(rows[4]).toMatchObject({ version: 1, changed: ["First release"] });
    // History opens comparing the changes not live with the version before them.
    expect(defaultPicks(rows)).toEqual([rows[0]!.key, rows[1]!.key]);
  });
});

describe("two bodies side by side", () => {
  it("lists only the fields that differ, and opens a changed list one entry at a time", () => {
    const left = {
      name: "Wand of Fireballs",
      tags: [],
      description: "Cast Fireball.",
      features: [
        { id: "ward", name: "Brine Ward", description: "Reduce the damage by 1d6." },
        { id: "riptide", name: "Riptide", description: "Pull a creature." }
      ]
    };
    const right = {
      name: "Wand of Saltfire",
      description: "Cast Brine Burst.",
      features: [
        { id: "ward", name: "Brine Ward", description: "Reduce the damage by 1d8." },
        { id: "riptide", name: "Riptide", description: "Pull a creature.", levels: [3] }
      ]
    };
    const rows = compareBodies("class", left, right);
    // An empty list and a missing one are the same; an entry whose words match is no row of words.
    expect(rows.map((row) => row.label)).toEqual(["Name", "Description", "Brine Ward"]);
    expect(rows[2]).toMatchObject({ left: "Reduce the damage by 1d6.", right: "Reduce the damage by 1d8." });
  });

  it("marks only the words that moved", () => {
    const { left, right } = diffWords("Reduce the damage by 1d6 plus", "Reduce the damage by 1d8 plus");
    expect(left.filter((run) => run.changed).map((run) => run.text)).toEqual(["1d6"]);
    expect(right.filter((run) => run.changed).map((run) => run.text)).toEqual(["1d8"]);
  });
});

describe("a save that met a newer copy", () => {
  const base = { name: "Saltborn", summary: "Sea folk.", description: "", tags: ["sea"] };
  const local = { name: "Saltborn", summary: "With the sea in their blood.", description: "", tags: [] };
  const server = { name: "Saltborn", summary: "Sea folk.", description: "Their eyes shine green.", tags: ["sea"] };

  it("keeps both devices' changes by default", () => {
    const rows = mergeRows("species", base, local, server);
    expect(rows.map((row) => [row.key, row.changedHere, row.changedThere])).toEqual([
      ["summary", true, false],
      ["description", false, true],
      ["tags", true, false]
    ]);
    expect(mergedDraft(local, server, defaultKeeps(rows))).toEqual({
      name: "Saltborn",
      summary: "With the sea in their blood.",
      description: "Their eyes shine green.",
      tags: []
    });
  });

  it("takes the other device's value for a field the GM picks it for", () => {
    const rows = mergeRows("species", base, local, server);
    const keeps = { ...defaultKeeps(rows), summary: "there" as const };
    expect(mergedDraft(local, server, keeps)).toMatchObject({
      summary: "Sea folk.",
      description: "Their eyes shine green."
    });
  });
});

import { describe, expect, it } from "vitest";
import type { ActorDefinition } from "@vtt/schemas";
import { classColumnsOf } from "../src/class-columns.js";
import { ContentLibrary } from "../src/content-library.js";

// SRD 5.2.1 class tables print columns no use counts: the Bard's Bardic Die (d6, d8 at level 5), the Rogue's Sneak
// Attack, the Barbarian's Rage Damage. The sheet shows them at the character's level in each class.

const library = new ContentLibrary().forAudience("play");
const sheet = (classes: ReadonlyArray<readonly [string, number]>) =>
  ({
    character: {
      classes: classes.map(([id, level]) => ({ id, name: library.classRecord(id)!.name, level })),
      feats: []
    }
  }) as unknown as ActorDefinition;
const columns = (classes: ReadonlyArray<readonly [string, number]>) =>
  classColumnsOf(sheet(classes), (id) => library.classRecord(id)).map((column) => [column.name, column.value]);

describe("the class table's columns on the sheet", () => {
  it("names the Bardic Die at each Bard level", () => {
    expect(columns([["bard", 4]])).toContainEqual(["Bardic Die", "d6"]);
    expect(columns([["bard", 5]])).toContainEqual(["Bardic Die", "d8"]);
  });

  it("reads each class of a multiclass sheet at its own level", () => {
    const multiclass = columns([
      ["rogue", 5],
      ["barbarian", 2]
    ]);
    expect(multiclass).toContainEqual(["Sneak Attack", "3d6"]);
    expect(multiclass).toContainEqual(["Rage Damage", "+2"]);
  });

  it("leaves out a column a use counts", () => {
    expect(columns([["monk", 5]]).map(([name]) => name)).not.toContain("Focus Points");
    expect(columns([["monk", 5]])).toContainEqual(["Martial Arts", "1d8"]);
  });
});

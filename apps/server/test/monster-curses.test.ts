import { describe, expect, it } from "vitest";
import { endCursesOn } from "../src/spell-endings.js";
import { actor, answer, conditionsOf, IDS, table, use } from "./monster-table.js";

// SRD 5.2.1 Lamia, Corrupting Touch: "Failure: 13 (3d8) Psychic damage, and the target is cursed for 1 hour. Until the
// curse ends, the target has the Charmed and Poisoned conditions." Remove Curse ends "all curses affecting one
// creature", so it ends both conditions with the curse.

describe("a lamia's Corrupting Touch", () => {
  it("leaves its Charmed and Poisoned as a curse for the hour, which Remove Curse's ending lifts", () => {
    const built = table("lamia");
    use(built, "corrupting-touch", [IDS.hero], [4, 4, 4]);
    answer(built, IDS.hero, 2);
    expect(conditionsOf(built, IDS.hero).sort()).toEqual(["charmed", "poisoned"]);
    const curse = actor(built, IDS.hero).effects.find((effect) => effect.tags.includes("curse"));
    expect(curse).toMatchObject({ name: "Cursed", duration: { type: "minutes", remaining: 60 } });
    endCursesOn(built.state, IDS.hero);
    expect(conditionsOf(built, IDS.hero)).toEqual([]);
  });
});

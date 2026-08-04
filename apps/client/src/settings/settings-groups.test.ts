import { describe, expect, it } from "vitest";
import { SETTINGS_GROUPS, groupsFor } from "./SettingsPage";

/**
 * D24's shape, pinned. Settings is "one tab, three groups, one page", and a player sees **Mine** only
 * — a sentence that is worth nothing unless something fails when it stops being true.
 *
 * This pins the DECLARATION rather than the DOM. The page renders from `SETTINGS_GROUPS`, and the
 * GM-only groups are gated on a GM token in one place, so a fourth group or a re-audienced group
 * changes this list before it changes any markup. A DOM test would pass just as happily against a
 * player page that mounted the GM controls and hid them with CSS; this cannot.
 */
describe("Settings groups (D24)", () => {
  it("is three groups, in the order the page renders them", () => {
    expect(SETTINGS_GROUPS.map((group) => group.id)).toEqual(["mine", "table", "players"]);
    expect(SETTINGS_GROUPS.map((group) => group.label)).toEqual(["Mine", "The table", "Players"]);
  });

  it("shows a player Mine and nothing else", () => {
    expect(groupsFor("player").map((group) => group.id)).toEqual(["mine"]);
  });

  it("shows the GM all three", () => {
    expect(groupsFor("gm").map((group) => group.id)).toEqual(["mine", "table", "players"]);
  });

  it("keeps every group that is not Mine GM-audienced", () => {
    for (const group of SETTINGS_GROUPS) {
      expect(group.audience, `${group.id} audience`).toBe(group.id === "mine" ? "everyone" : "gm");
    }
  });
});

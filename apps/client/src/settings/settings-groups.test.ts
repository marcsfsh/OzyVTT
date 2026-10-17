import { describe, expect, it } from "vitest";
import { SETTINGS_GROUPS, groupsFor } from "./SettingsPage";

/**
 * Pins the Settings declaration and leaves the DOM alone: a player sees Mine only. A DOM test would also
 * pass for a page that mounted the GM controls and hid them with CSS.
 */
describe("Settings groups", () => {
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

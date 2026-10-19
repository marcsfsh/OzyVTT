import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS, homeSection, searchSettings, sectionsFor, settingsFor, SETTING } from "./sections";

/**
 * Pins the Settings declaration and leaves the DOM alone: a player gets the Device section and nothing else. A DOM
 * test would also pass for a page that mounted the GM controls and hid them with CSS.
 */
describe("Settings sections", () => {
  it("is six sections, in the order the bar lists them", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      "players",
      "fights",
      "characters",
      "device",
      "access",
      "api"
    ]);
  });

  it("gives a player Device and nothing else, and lands them there", () => {
    expect(sectionsFor("player").map((section) => section.id)).toEqual(["device"]);
    expect(homeSection("player")).toBe("device");
  });

  it("gives the GM all six, and lands on Players for the join address", () => {
    expect(sectionsFor("gm")).toHaveLength(6);
    expect(homeSection("gm")).toBe("players");
  });

  it("keeps every section but Device GM-audienced", () => {
    for (const section of SETTINGS_SECTIONS)
      expect(section.audience, `${section.id} audience`).toBe(section.id === "device" ? "everyone" : "gm");
  });

  it("gives every setting a label and one sentence of hint", () => {
    for (const setting of Object.values(SETTING)) {
      expect(setting.label.trim(), setting.id).not.toBe("");
      expect(setting.hint, setting.id).toMatch(/^[A-Z].*\.$/);
      expect(setting.hint.split(/[.!?] /), `${setting.id} is one sentence`).toHaveLength(1);
    }
  });
});

describe("the search over settings", () => {
  it("finds a player only the settings a player has", () => {
    const ids = settingsFor("player").map((setting) => setting.id);
    expect(ids).toEqual(["theme", "rollInput", "pinchZoom", "leaveTable"]);
    expect(searchSettings(settingsFor("player"), "rules")).toEqual([]);
  });

  it("matches labels, hints and other words, and puts label matches first", () => {
    const gm = settingsFor("gm");
    expect(searchSettings(gm, "password").map((setting) => setting.id)).toEqual(["gmPassword", "signOut"]);
    expect(searchSettings(gm, "dawn").map((setting) => setting.id)).toEqual(["theme"]);
    expect(searchSettings(gm, "qr").map((setting) => setting.id)).toEqual(["joinAddress"]);
    // Every word must match: "spell slots" finds the rules assistant, which checks them.
    expect(searchSettings(gm, "spell slots").map((setting) => setting.id)).toEqual(["rulesAssistant"]);
    const level = searchSettings(gm, "level").map((setting) => setting.id);
    expect(level[0]).toBe("maxLevel");
    expect(level).toContain("playerBuilder");
    expect(searchSettings(gm, "   ")).toEqual([]);
  });

  it("never offers the GM a player's way out, nor a player a GM row", () => {
    expect(settingsFor("gm").map((setting) => setting.id)).not.toContain("leaveTable");
    expect(settingsFor("player").map((setting) => setting.id)).not.toContain("arrangeScenes");
  });
});

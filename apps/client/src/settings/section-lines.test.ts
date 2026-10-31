import { describe, expect, it } from "vitest";
import { GameStateSchema, type GmView } from "@vtt/domain";
import { countWords, sectionLine, type DeviceFacts } from "./sectionLines";

// Settings' lines (settings spec 2.1): what each section holds now, in the settings' own words.

function gm(change: (state: GmView) => void = () => {}): GmView {
  const state = GameStateSchema.parse({ schemaVersion: 1 }) as unknown as GmView;
  change(state);
  return state;
}
const device: DeviceFacts = { theme: "dusk", rollInput: "digital", pinchZoom: false, activeCredentials: 2 };

describe("Settings' section lines", () => {
  it("says the counts the GM set in words, up to ten", () => {
    expect(countWords(6, "check", "checks")).toBe("six checks");
    expect(countWords(1, "method", "methods")).toBe("one method");
    expect(countWords(12, "check", "checks")).toBe("12 checks");
  });

  it("names the rules assistant, its checks and who applies hits", () => {
    expect(sectionLine("fights", gm(), device)).toBe("Enforce · six checks · hits applied by the GM");
    const advise = gm((state) => {
      state.rulesPolicy = { dial: "assisted", exceptions: { movement: "freeform", slots: "freeform" } };
      (state.combat as { playerDamageMode: string }).playerDamageMode = "direct";
    });
    expect(sectionLine("fights", advise, device)).toBe("Advise · four checks · hits applied immediately");
    const off = gm((state) => {
      state.rulesPolicy = { dial: "freeform", exceptions: {} };
    });
    expect(sectionLine("fights", off, device)).toMatch(/^Off · checks nothing · /);
  });

  it("says who builds characters, to which level, with how many ways to set scores", () => {
    expect(sectionLine("characters", gm(), device)).toMatch(/^Players build · level \d+ · \w+ methods?$/);
    const closed = gm((state) => {
      state.builderPolicy = { ...state.builderPolicy, playerBuilder: "gm-only", maxLevel: 5 };
    });
    expect(sectionLine("characters", closed, device)).toMatch(/^Only you build · level 5 · /);
  });

  it("reads the device's own choices and the active credentials", () => {
    expect(sectionLine("device", null, device)).toBe("Dusk · auto-roll · pinch zoom off");
    expect(sectionLine("device", null, { ...device, theme: "dawn", rollInput: "manual", pinchZoom: true })).toBe(
      "Dawn · you roll · pinch zoom on"
    );
    expect(sectionLine("access", null, device)).toBe("2 credentials active");
    expect(sectionLine("access", null, { ...device, activeCredentials: 1 })).toBe("1 credential active");
    expect(sectionLine("api", null, device)).toBe("Every operation, with examples");
  });

  it("counts the players at the table and says what they see of each other", () => {
    expect(sectionLine("players", gm(), device)).toBe("Join address · name and class · 0 at the table");
  });
});

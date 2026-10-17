import { describe, expect, it } from "vitest";
import { shortcutLabel } from "./shortcut";

describe("a shortcut's label", () => {
  it("writes Command on a Mac and Ctrl elsewhere", () => {
    expect(shortcutLabel("K", { platform: "MacIntel", touchOnly: false })).toBe("⌘K");
    expect(shortcutLabel("K", { platform: "macOS", touchOnly: false })).toBe("⌘K");
    expect(shortcutLabel("K", { platform: "Win32", touchOnly: false })).toBe("Ctrl K");
    expect(shortcutLabel("K", { platform: "Linux x86_64", touchOnly: false })).toBe("Ctrl K");
  });

  it("offers none on a touch device, which has no keys to press", () => {
    expect(shortcutLabel("K", { platform: "iPhone", touchOnly: true })).toBeNull();
    expect(shortcutLabel("K", { platform: "MacIntel", touchOnly: true })).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, getStoredTheme, resolveTheme } from "./theme";

// The startup decision: an explicit saved choice wins, a retired id keeps its side of light and dark and is
// rewritten, and anything else follows the system. Storage that throws never stops a theme from rendering.

function systemPrefers(light: boolean | "unreadable") {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    if (light === "unreadable") throw new Error("matchMedia is unavailable");
    return { matches: query === "(prefers-color-scheme: light)" && light, media: query } as MediaQueryList;
  });
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("resolveTheme", () => {
  it.each([
    ["dark", false, "dusk", "dusk"],
    ["dark", true, "dusk", "dusk"],
    ["light", false, "dawn", "dawn"],
    ["light", true, "dawn", "dawn"],
    ["dusk", true, "dusk", null],
    ["dawn", false, "dawn", null],
    [null, false, "dusk", null],
    [null, true, "dawn", null],
    ["sepia", true, "dawn", null],
    ["", false, "dusk", null]
  ] as const)("renders %j with the system preferring light %s as %s, writing back %s", (stored, light, theme, back) => {
    expect(resolveTheme(stored, light)).toEqual({ theme, writeback: back });
  });
});

describe("getStoredTheme", () => {
  it("rewrites a retired id on first read", () => {
    systemPrefers(true);
    localStorage.setItem("vtt.theme", "dark");
    expect(getStoredTheme()).toBe("dusk");
    expect(localStorage.getItem("vtt.theme")).toBe("dusk");
    localStorage.setItem("vtt.theme", "light");
    expect(getStoredTheme()).toBe("dawn");
    expect(localStorage.getItem("vtt.theme")).toBe("dawn");
  });

  it("keeps a saved Dusk or Dawn over the system, and stores nothing when following the system", () => {
    systemPrefers(true);
    localStorage.setItem("vtt.theme", "dusk");
    expect(getStoredTheme()).toBe("dusk");
    localStorage.removeItem("vtt.theme");
    expect(getStoredTheme()).toBe("dawn");
    expect(localStorage.getItem("vtt.theme")).toBeNull();
  });

  it("follows the system when storage can't be read, and uses Dusk when the system can't be read either", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    systemPrefers(true);
    expect(getStoredTheme()).toBe("dawn");
    systemPrefers("unreadable");
    expect(getStoredTheme()).toBe("dusk");
  });

  it("keeps the migrated theme when the rewrite fails", () => {
    systemPrefers(false);
    localStorage.setItem("vtt.theme", "light");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(getStoredTheme()).toBe("dawn");
  });
});

describe("applyTheme", () => {
  it("sets the theme and the browser chrome's colour, and still applies when storage fails", () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    applyTheme("dawn");
    expect(document.documentElement).toHaveAttribute("data-theme", "dawn");
    expect(meta).toHaveAttribute("content", "#ebe7ef");
    applyTheme("dusk");
    expect(meta).toHaveAttribute("content", "#151a2d");
    meta.remove();
  });
});

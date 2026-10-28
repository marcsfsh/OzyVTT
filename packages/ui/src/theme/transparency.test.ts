import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// Reduction is the device setting OR the system's request. The setting is kept per device, and it can't switch off
// what the system asks for.

let systemReduces = false;
let changeListener: ((event: MediaQueryListEvent) => void) | null = null;

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  systemReduces = false;
  changeListener = null;
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query === "(prefers-reduced-transparency: reduce)" && systemReduces,
        media: query,
        addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => (changeListener = listener),
        removeEventListener: () => (changeListener = null)
      }) as unknown as MediaQueryList
  );
});
afterEach(() => document.documentElement.removeAttribute("data-transparency"));

const load = () => import("./transparency");
const reducedAttribute = () => document.documentElement.getAttribute("data-transparency");

describe("Reduce transparency", () => {
  it("is off by default, and on when the setting is on, kept on this device", async () => {
    const { initTransparency, setReduceTransparency, transparencyReduced } = await load();
    initTransparency();
    expect(transparencyReduced()).toBe(false);
    expect(reducedAttribute()).toBeNull();
    setReduceTransparency(true);
    expect(reducedAttribute()).toBe("reduced");
    expect(localStorage.getItem("vtt.reduce-transparency")).toBe("on");
    setReduceTransparency(false);
    expect(reducedAttribute()).toBeNull();
    expect(localStorage.getItem("vtt.reduce-transparency")).toBe("off");
  });

  it("reads the stored setting at startup", async () => {
    localStorage.setItem("vtt.reduce-transparency", "on");
    const { initTransparency } = await load();
    initTransparency();
    expect(reducedAttribute()).toBe("reduced");
  });

  it("stays on while the system asks, whatever the setting, and follows the system changing", async () => {
    systemReduces = true;
    const { initTransparency, setReduceTransparency, useReduceTransparency } = await load();
    initTransparency();
    const { result } = renderHook(() => useReduceTransparency());
    expect(result.current).toEqual({ setting: false, system: true });
    setReduceTransparency(false);
    expect(reducedAttribute()).toBe("reduced");
    act(() => changeListener?.({ matches: false } as MediaQueryListEvent));
    expect(result.current).toEqual({ setting: false, system: false });
    expect(reducedAttribute()).toBeNull();
  });

  it("still applies when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { initTransparency, setReduceTransparency } = await load();
    initTransparency();
    setReduceTransparency(true);
    expect(reducedAttribute()).toBe("reduced");
  });
});

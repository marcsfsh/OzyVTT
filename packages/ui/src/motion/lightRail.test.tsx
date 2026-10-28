import { readFileSync } from "node:fs";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreAnimate, stubAnimate } from "../../test/animate";
import { holdMotion, motionReleased, releaseMotion } from "./gate";
import { useOnChange } from "./hooks";
import {
  COMET_MAX,
  EASE,
  LIGHT_TIMING,
  TIMING_TOKENS,
  canMove,
  burst,
  comet,
  cometPath,
  drain,
  fill,
  flipDelta,
  horizonAt,
  parseDuration,
  pop,
  stripSwitch,
  wash,
  type Box
} from "./lightRail";

const tokens = readFileSync(`${process.cwd()}/src/styles/design-tokens.css`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** A token's value in `:root`, the first declaration in the file. */
const rootToken = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1].trim();

const box = (x: number, w: number): Box => ({ x, y: 0, w, h: 44, cx: x + w / 2, cy: 22, r: x + w, b: 44 });

afterEach(() => {
  restoreAnimate();
  releaseMotion();
});

describe("the comet's path", () => {
  it("runs right with its head on the right, stretching at 65% and shrinking into its head", () => {
    const path = cometPath({ from: 40, to: 240, line: 10 });
    expect(path.dir).toBe(1);
    expect(path.face).toBe("lr-face-r");
    expect(path.len).toBe(200);
    expect(path.css).toMatchObject({ left: "-200px", width: "200px", top: "8px", height: "4px" });
    expect(path.frames).toEqual([
      { transform: "translateX(40px) scaleX(0)" },
      { offset: 0.65, transform: "translateX(210px) scaleX(1)" },
      { transform: "translateX(240px) scaleX(0)" }
    ]);
  });

  it("runs left with its head on the left", () => {
    const path = cometPath({ from: 240, to: 40, line: 10 });
    expect(path.dir).toBe(-1);
    expect(path.face).toBe("lr-face-l");
    expect(path.css.left).toBe("0px");
    expect(path.frames[1]).toEqual({ offset: 0.65, transform: "translateX(70px) scaleX(1)" });
  });

  it("caps the tail at 260px, or the cap it is given, and never draws it shorter than 24px", () => {
    expect(COMET_MAX).toBe(260);
    expect(cometPath({ from: 0, to: 1200, line: 0 }).len).toBe(260);
    expect(cometPath({ from: 0, to: 1200, line: 0, maxLen: 320 }).len).toBe(320);
    expect(cometPath({ from: 0, to: 6, line: 0 }).len).toBe(24);
  });

  it("runs down a vertical strip on its own axis", () => {
    const path = cometPath({ from: 10, to: 110, line: 2, axis: "y", thick: 3 });
    expect(path.face).toBe("lr-face-d");
    expect(path.css).toMatchObject({ top: "-100px", height: "100px", left: "0.5px", width: "3px" });
    expect(path.frames[2]).toEqual({ transform: "translateY(110px) scaleY(0)" });
  });
});

describe("drain and fill", () => {
  beforeEach(() => stubAnimate());

  it("grow and shrink along the line from the origin they are given", () => {
    const ink = document.createElement("span");
    fill(ink, { origin: "0%" });
    expect(ink.style.transformOrigin).toBe("0% 50%");
    drain(ink, { origin: "100%", axis: "y" });
    expect(ink.style.transformOrigin).toBe("50% 100%");
  });

  it("drain the old ink toward the trip and fill the new from the side the light arrived on", () => {
    const played = stubAnimate();
    const strip = document.createElement("div");
    const ink = document.createElement("span");
    ink.className = "nh-tabs-ink";
    strip.append(ink);
    document.body.append(strip);

    stripSwitch(strip, { ink, from: box(0, 80), to: box(200, 80), line: 43 });
    const ghost = strip.querySelector<HTMLElement>(".lr-ink-ghost")!;
    expect(ghost.style.transformOrigin).toBe("100% 50%");
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    expect(ghost.style.left).toBe("0px");
    expect(ink.style.transformOrigin).toBe("0% 50%");
    expect(strip.querySelector(".lr-comet.lr-face-r")).not.toBeNull();
    expect(strip.querySelector(".lr-burst")).not.toBeNull();

    stripSwitch(strip, { ink, from: box(200, 80), to: box(0, 80), line: 43, travel: false });
    expect(strip.querySelectorAll(".lr-ink-ghost")[1]).toHaveStyle({ transformOrigin: "0% 50%" });
    expect(ink.style.transformOrigin).toBe("100% 50%");
    expect(strip.querySelector(".lr-comet.lr-face-l")).toBeNull();
    played.forEach((call) => call.finish());
    strip.remove();
  });

  it("leave nothing behind when the light is cancelled", async () => {
    const played = stubAnimate();
    const host = document.createElement("div");
    document.body.append(host);
    comet(host, { from: 0, to: 300, line: 2 });
    wash(host, { at: 120 });
    expect(host.querySelectorAll(".lr-part")).toHaveLength(2);
    expect(host.querySelector(".lr-part")).toHaveAttribute("aria-hidden", "true");
    played.forEach((call) => call.cancel());
    await Promise.resolve();
    await Promise.resolve();
    expect(host.querySelectorAll(".lr-part")).toHaveLength(0);
    host.remove();
  });
});

describe("flip", () => {
  it("slides from where the element was, and not at all when it barely moved", () => {
    const at = (left: number, top: number) => ({ left, top }) as DOMRectReadOnly;
    expect(flipDelta(at(40, 100), at(0, 60))).toEqual({ dx: 40, dy: 40 });
    expect(flipDelta(at(0, 60), at(0, 100))).toEqual({ dx: 0, dy: -40 });
    expect(flipDelta(at(10.2, 4), at(10, 4.3))).toBeNull();
  });
});

describe("canMove", () => {
  it("is false without the Web Animations API, as in jsdom", () => {
    expect(canMove()).toBe(false);
    expect(comet(document.body, { from: 0, to: 100, line: 0 })).toBeNull();
  });

  it("is true with the API and nothing holding it back", () => {
    stubAnimate();
    expect(canMove()).toBe(true);
  });

  it("is false under reduced motion, read on every call", () => {
    stubAnimate();
    const original = window.matchMedia;
    let reduced = true;
    window.matchMedia = ((query: string) =>
      ({ matches: reduced && query.includes("reduce"), media: query }) as MediaQueryList) as typeof window.matchMedia;
    expect(canMove()).toBe(false);
    reduced = false;
    expect(canMove()).toBe(true);
    window.matchMedia = original;
  });

  it("is false while the gate is held, until a frame after it is released", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    stubAnimate();
    holdMotion();
    expect(canMove()).toBe(false);
    releaseMotion();
    expect(motionReleased()).toBe(false);
    vi.advanceTimersToNextFrame();
    expect(canMove()).toBe(true);
    vi.useRealTimers();
  });

  it("is false while the page is hidden", () => {
    stubAnimate();
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    expect(canMove()).toBe(false);
    spy.mockRestore();
  });
});

describe("timing", () => {
  it("mirrors the tokens in design-tokens.css", () => {
    for (const key of Object.keys(TIMING_TOKENS) as Array<keyof typeof TIMING_TOKENS>)
      expect(parseDuration(rootToken(TIMING_TOKENS[key]) ?? ""), TIMING_TOKENS[key]).toBe(LIGHT_TIMING[key]);
    expect(rootToken("--ease-travel")).toBe(EASE.travel);
    expect(rootToken("--ease-settle")).toBe(EASE.settle);
  });

  it("reads durations in ms or s", () => {
    expect(parseDuration("130ms")).toBe(130);
    expect(parseDuration(" 0.2s ")).toBe(200);
    expect(parseDuration("")).toBeNull();
  });
});

describe("useOnChange", () => {
  function Watch({ value, seen }: Readonly<{ value: number; seen: (from: number, to: number) => void }>) {
    useOnChange(value, seen);
    return null;
  }

  it("skips the first render and reports each change with the value before it", () => {
    const seen = vi.fn();
    const { rerender } = render(<Watch value={0} seen={seen} />);
    expect(seen).not.toHaveBeenCalled();
    rerender(<Watch value={0} seen={seen} />);
    expect(seen).not.toHaveBeenCalled();
    act(() => rerender(<Watch value={12} seen={seen} />));
    expect(seen).toHaveBeenCalledWith(0, 12);
    act(() => rerender(<Watch value={7} seen={seen} />));
    expect(seen).toHaveBeenLastCalledWith(12, 7);
  });
});

describe("horizon light", () => {
  /** The five stops a block of the token file declares, as `rgb(r, g, b)`. */
  const stopsIn = (block: string) =>
    [1, 2, 3, 4, 5].map((index) => {
      const hex = new RegExp(`--hz-${index}:\\s*#([0-9a-f]{6});`, "i").exec(block)![1]!;
      return `rgb(${[0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;
    });
  const dawnBlock = /\[data-theme="dawn"\] \{([^}]*)\}/.exec(tokens)![1]!;
  let style: HTMLStyleElement;
  beforeEach(() => {
    style = document.createElement("style");
    style.textContent = readFileSync(`${process.cwd()}/src/styles/design-tokens.css`, "utf8");
    document.head.append(style);
  });
  afterEach(() => {
    style.remove();
    document.documentElement.removeAttribute("data-theme");
  });

  it("reads the horizon's colour at each stop and between them, in Dusk and Dawn", () => {
    const root = document.documentElement;
    for (const [theme, stops] of [
      ["dusk", stopsIn(tokens)],
      ["dawn", stopsIn(dawnBlock)]
    ] as const) {
      if (theme === "dawn") root.setAttribute("data-theme", "dawn");
      expect(
        [0, 0.3, 0.6, 0.85, 1].map((t) => horizonAt(t, root)),
        theme
      ).toEqual(stops);
      expect(horizonAt(-1, root)).toBe(stops[0]);
      expect(horizonAt(2, root)).toBe(stops[4]);
    }
    root.removeAttribute("data-theme");
    // Half way from cyan (79, 227, 255) to violet (154, 92, 255).
    expect(horizonAt(0.15, root)).toBe("rgb(117, 160, 255)");
  });

  it("colours light with no meaning of its own by where it leaves and lands, and leaves toned light alone", () => {
    stubAnimate();
    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { value: 400 });
    document.body.append(host);
    comet(host, { from: 0, to: 300, line: 2 });
    comet(host, { from: 0, to: 300, line: 2, tone: "gold" });
    const [plain, gold] = [...host.querySelectorAll<HTMLElement>(".lr-comet")];
    expect(plain!.classList.contains("lr-hz")).toBe(true);
    expect(plain!.style.getPropertyValue("--lr-tail-a")).toBe(horizonAt(0, host));
    expect(plain!.style.getPropertyValue("--lr-tail-b")).toBe(horizonAt(0.75, host));
    expect(gold!.classList.contains("lr-hz")).toBe(false);
    expect(gold!.style.getPropertyValue("--lr-tail-a")).toBe("");

    burst(host, { at: 400, line: 2 });
    pop(host, { x: 200, y: 10 });
    pop(host, { x: 200, y: 10, color: "var(--party)" });
    const ring = host.querySelector<HTMLElement>(".lr-burst")!;
    expect(ring.classList.contains("lr-hz")).toBe(true);
    expect(ring.style.getPropertyValue("--lr-ring")).toBe(horizonAt(1, host));
    const [round, party] = [...host.querySelectorAll<HTMLElement>(".lr-pop")];
    expect(round!.style.getPropertyValue("--lr-ring")).toBe(horizonAt(0.5, host));
    expect(party!.classList.contains("lr-hz")).toBe(false);
    host.remove();
  });
});

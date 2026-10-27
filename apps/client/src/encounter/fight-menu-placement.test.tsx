import { describe, expect, it, vi } from "vitest";

// `command()` and `read()` send through `socket.timeout(ms).emit` with an error-first ack; it is routed to
// `socket.emit` here so the assertions read one call list.
vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { placeFightMenu } from "./FightMenu";

/**
 * Where the ⋯ fight menu lands. The rects are real ones read off the running app at each viewport.
 * The old rule placed it below the trigger and took whatever height was left, which near the bottom
 * of a landscape phone was nothing (844x390 and 667x375 gave `max-height: 0px`; 320x568 gave 111px).
 * The trigger's height is the topbar's `--control-h`, the 44px tap floor.
 */

/** Taller than any viewport here: the menu's measured content height. */
const NATURAL = 1028;
const trigger = (top: number, right = 800) => ({ top, bottom: top + 44, right });

describe("the encounter menu opens where there is room", () => {
  it("opens downward on a laptop, unchanged", () => {
    // 1280x900, GM in combat: the topbar sits at y=192.
    const box = placeFightMenu(trigger(192, 1152), NATURAL, { width: 1280, height: 900 });
    expect(box.top).toBe(242);
    expect(box.bottom).toBe("auto");
    expect(box.maxHeight).toBe(650);
  });

  it("opens downward on a portrait phone, where below is still the bigger side", () => {
    // 390x844: roomBelow 387 vs roomAbove 385. It fits neither way, so it takes the bigger, which is below.
    const box = placeFightMenu(trigger(399, 372), NATURAL, { width: 390, height: 844 });
    expect(box.top).toBe(449);
    expect(box.bottom).toBe("auto");
    expect(box.maxHeight).toBe(387);
  });

  it("flips up on a landscape phone, where below is nothing", () => {
    // 844x390 with the turn row pinned to the dock scroller's top: the trigger sits at 326-370, which leaves
    // 6px under it and 312 over it.
    const box = placeFightMenu(trigger(326), NATURAL, { width: 844, height: 390 });
    expect(box.top).toBe("auto");
    expect(box.bottom).toBe(70); // 390 - 326 + 6: anchored just above the trigger
    expect(box.maxHeight).toBe(312);
    expect(box.maxHeight / 390).toBeGreaterThan(0.5); // "a substantial fraction of the viewport"
  });

  it("flips up on the shortest landscape phone too", () => {
    // 667x375, trigger at 311-355.
    const box = placeFightMenu(trigger(311, 649), NATURAL, { width: 667, height: 375 });
    expect(box.top).toBe("auto");
    expect(box.maxHeight).toBe(297);
  });

  it("flips up at 320x568, where downward gave 10.6% of the menu", () => {
    const box = placeFightMenu(trigger(399, 302), NATURAL, { width: 320, height: 568 });
    expect(box.top).toBe("auto");
    expect(box.maxHeight).toBe(385);
    // The old rule gave 111px of 1028.
    expect(box.maxHeight).toBeGreaterThan(111);
  });

  it("does not flip when it does not need to", () => {
    // The flip happens only when the content does not fit below, as in `packages/ui/src/primitives/Menu.tsx`:
    // far more room above (686px) than below (250px), and it still opens downward because it fits.
    const box = placeFightMenu(trigger(700, 1152), 200, { width: 1280, height: 1000 });
    expect(box.top).toBe(750);
    expect(box.bottom).toBe("auto");
  });

  it("never returns a zero cap: when neither side is usable it takes the viewport column", () => {
    // A very short window: 44px above, 42px below, neither enough for a control and the End button.
    // The old `Math.max(0, …)` made this a 24px box.
    const box = placeFightMenu(trigger(58), NATURAL, { width: 844, height: 160 });
    expect(box.top).toBe(8);
    expect(box.bottom).toBe("auto");
    expect(box.maxHeight).toBe(144); // 160 - 8 - 8: the whole column, and the menu scrolls itself
  });
});

describe("the encounter menu stays inside the viewport horizontally", () => {
  it("right-aligns to its trigger when there is room", () => {
    expect(placeFightMenu(trigger(192, 1152), NATURAL, { width: 1280, height: 900 }).left).toBe(768);
  });

  it("does not run off the left edge when the trigger is near it", () => {
    expect(placeFightMenu(trigger(192, 120), NATURAL, { width: 1280, height: 900 }).left).toBe(8);
  });

  it("narrows to the viewport when the viewport is narrower than the menu", () => {
    const box = placeFightMenu(trigger(399, 302), NATURAL, { width: 320, height: 568 });
    expect(box.width).toBe(304); // 320 - 8 - 8
    expect(box.left).toBe(8);
  });
});

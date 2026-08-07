import { describe, expect, it, vi } from "vitest";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true } }));

import { placeFightMenu } from "./EncounterPanel";

/**
 * WHERE THE ⋯ FIGHT MENU LANDS — the rule, pinned to the geometry that broke it.
 *
 * On 2026-08-07 a GM could not end a fight on a landscape phone. The menu computed one candidate
 * position (below the trigger), clamped its `top` into the viewport, and took whatever height was
 * left; near the bottom of the window that is nothing. Measured on the running app, GM in combat:
 *
 *   844x390   inline `max-height: 0px`, a 24px box over 1028px of content,
 *             `elementFromPoint` at "End the fight" -> DIV.encounter-menu-backdrop
 *   667x375   identical
 *   320x568   `max-height: 111px` — 10.6% of the menu visible at a time
 *
 * These are unit tests and not a browser drive on purpose: the defect was arithmetic, the browser
 * pass is recorded separately, and arithmetic is the half that can regress silently a year from now
 * when somebody "simplifies" the effect. The rects below are the real ones read off the running app
 * at each viewport, so a future reader can re-take them rather than trust them.
 *
 * The trigger's height is the topbar's `--control-h`, the 44px tap floor.
 */

/** Taller than any viewport here, which is the point: 1028px is the menu's measured content height. */
const NATURAL = 1028;
const trigger = (top: number, right = 800) => ({ top, bottom: top + 44, right });

describe("the fight menu opens where there is room", () => {
  it("opens downward on a laptop, unchanged", () => {
    // 1280x900, GM in combat: the topbar sits at y=192. Measured before this rule existed: 649.7px.
    const box = placeFightMenu(trigger(192, 1152), NATURAL, { width: 1280, height: 900 });
    expect(box.top).toBe(242);
    expect(box.bottom).toBe("auto");
    expect(box.maxHeight).toBe(650);
  });

  it("opens downward on a portrait phone, where below is still the bigger side", () => {
    // 390x844: roomBelow 387 vs roomAbove 385. It does not fit either way, so it takes the bigger —
    // and the bigger is still below. Measured before this rule existed: 387.3px, i.e. no change.
    const box = placeFightMenu(trigger(399, 372), NATURAL, { width: 390, height: 844 });
    expect(box.top).toBe(449);
    expect(box.bottom).toBe("auto");
    expect(box.maxHeight).toBe(387);
  });

  it("flips up on a landscape phone, where below is nothing", () => {
    // 844x390 with the turn row pinned to the dock scroller's top: the trigger sits at 326-370, so
    // there are 6px under it and 312 over it. This is the cell that measured `max-height: 0px`.
    const box = placeFightMenu(trigger(326), NATURAL, { width: 844, height: 390 });
    expect(box.top).toBe("auto");
    expect(box.bottom).toBe(70); // 390 - 326 + 6: anchored just above the trigger
    expect(box.maxHeight).toBe(312);
    expect(box.maxHeight / 390).toBeGreaterThan(0.5); // "a substantial fraction of the viewport"
  });

  it("flips up on the shortest landscape phone too", () => {
    // 667x375, trigger at 311-355. Measured `max-height: 0px` before.
    const box = placeFightMenu(trigger(311, 649), NATURAL, { width: 667, height: 375 });
    expect(box.top).toBe("auto");
    expect(box.maxHeight).toBe(297);
  });

  it("flips up at 320x568, where downward gave 10.6% of the menu", () => {
    const box = placeFightMenu(trigger(399, 302), NATURAL, { width: 320, height: 568 });
    expect(box.top).toBe("auto");
    expect(box.maxHeight).toBe(385);
    // The measured before-state was 111px of 1028. Anything at or under that has not been fixed.
    expect(box.maxHeight).toBeGreaterThan(111);
  });

  it("does not flip when it does not need to", () => {
    // A menu that flips up when it fits below is its own bug: the flip is conditional on the content
    // NOT fitting, exactly as `packages/ui/src/primitives/Menu.tsx` writes it. Here there is far more
    // room above (686px) than below (250px) — and the menu still opens downward, because it fits.
    const box = placeFightMenu(trigger(700, 1152), 200, { width: 1280, height: 1000 });
    expect(box.top).toBe(750);
    expect(box.bottom).toBe("auto");
  });

  it("never returns a zero cap: when neither side is usable it takes the viewport column", () => {
    // The trigger centred in a very short window — 44px above, 42px below, neither of which can hold
    // a control and the End button. This is the case the old `Math.max(0, …)` turned into a 24px box.
    const box = placeFightMenu(trigger(58), NATURAL, { width: 844, height: 160 });
    expect(box.top).toBe(8);
    expect(box.bottom).toBe("auto");
    expect(box.maxHeight).toBe(144); // 160 - 8 - 8: the whole column, and the menu scrolls itself
  });
});

describe("the fight menu stays inside the viewport horizontally", () => {
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

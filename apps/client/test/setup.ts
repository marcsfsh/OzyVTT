import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { goTo } from "./route";

/**
 * jsdom gaps this app actually hits, filled here in TEST setup only — never in product code.
 *
 * Each shim below was confirmed missing in jsdom 30 by probing it directly, not assumed. They exist so a
 * component can *render* under test; they are deliberately minimal and do not emulate real behaviour.
 *
 * **What this means for what these tests can prove:** a test passing under a shim is evidence about this
 * app's logic, not about the browser. Not verifiable here, and therefore still real-browser checks:
 * layout and pointer geometry (`MapSurface` panning, `RelationshipGraph` hit-testing, the 44px touch
 * floor — `getScreenCTM` is deliberately NOT shimmed, since faking a matrix would invent geometry);
 * Modal focus-trap / Escape / click-outside (the shim below is `show()` semantics, not `showModal()`);
 * and anything CSS-dependent, since no stylesheet is loaded. See `docs/ai-context/testing.md`.
 */

// Native <dialog>: the app's Modal calls showModal()/close(). jsdom implements neither.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, returnValue?: string) {
    this.open = false;
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event("close"));
  };
}

// Pointer capture: MapSurface/RelationshipGraph call these on every drag gesture.
if (typeof Element !== "undefined" && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

// Scrolling and observation APIs jsdom omits entirely. `scrollTo` is used by the scrolling Tabs bar —
// it did not show up in the upfront probe and only surfaced once real components rendered, which is a
// reminder that this list is empirical, not exhaustive.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false
  }) as unknown as MediaQueryList;
}

afterEach(() => cleanup());

/**
 * D3 made every Codex surface an ADDRESS, so a component test has to say which one it is rendering.
 * Each test file sets its own path (`goTo("/codex/pages")`); this resets the URL between tests so one
 * test's navigation cannot leak into the next, which is the same isolation `cleanup()` gives the DOM.
 *
 * It goes through `goTo` rather than raising a synthetic `popstate`, because the router now lets a dirty
 * autosave-off editor veto a real history traversal — and a teardown must never be something the code
 * under test can refuse. See `test/route.ts`.
 */
afterEach(() => { goTo("/"); });

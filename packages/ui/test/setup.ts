import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * jsdom gaps the PRIMITIVES hit, filled in test setup only — never in product code. Deliberately
 * shorter than the client's setup (`apps/client/test/setup.ts`): a primitive has no router and no map
 * surface, so only the platform APIs the design system itself calls are shimmed, and each was confirmed
 * missing by probing jsdom rather than assumed.
 *
 * **What this means for what these tests can prove:** no stylesheet is loaded here, so nothing in this
 * suite is evidence about geometry — not the 44px tap floor, not the D23 label band, not the
 * stable-width reservation. Those are asserted here as STRUCTURE (the element, the class, the attribute
 * that produces the geometry) and measured for real by the browser scripts in `scripts/`.
 */

// Native <dialog>: Modal calls showModal()/close(). jsdom implements neither.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, returnValue?: string) {
    this.open = false;
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event("close"));
  };
}

// The scrolling Tabs bar and the Combobox listbox both scroll a focused item into view.
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

import { afterEach } from "vitest";

const original = window.matchMedia;

/**
 * Answers width queries from a viewport width, for a test that renders the phone or the laptop layout. jsdom's shim
 * answers false to everything, which reads as a laptop. Any other query (hover, reduced motion) stays false.
 * Restored after each test.
 */
export function setViewport(width: number): void {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = max ? width <= Number(max[1]) : min ? width >= Number(min[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = original;
});

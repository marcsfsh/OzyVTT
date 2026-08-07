import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * `@vtt/ui`'s own tests. The package is consumed as SOURCE by the client's Vite build, so there is no
 * build step to test through — these run straight against `src/`.
 *
 * `jsdom` because every primitive here is a DOM contract. What jsdom cannot do is LAYOUT: no stylesheet
 * is loaded and no box is measured, so the alignment work (D23) is split deliberately — the structure
 * half is asserted here, the geometry half by `scripts/primitive-align-check.mjs` in a real browser.
 * Each test file states which half it is proving in its own header.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    clearMocks: true
  }
});

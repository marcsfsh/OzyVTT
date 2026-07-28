import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Client tests. Separate from `vite.config.ts` so the build config stays untouched.
 * `jsdom` because the Codex work under test is component behaviour (see `test/setup.ts` for the
 * jsdom gaps this app hits and what they mean for what these tests can honestly prove).
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

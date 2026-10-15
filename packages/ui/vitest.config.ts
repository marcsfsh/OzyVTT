import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Runs against `src/` directly (the package is consumed as source). jsdom does no layout, so tests here assert
 * structure.
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

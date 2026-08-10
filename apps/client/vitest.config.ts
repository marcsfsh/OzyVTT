import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Client tests. Separate from `vite.config.ts` so the build config stays untouched.
 *
 * TWO PROJECTS, because one of these tests is not a component test at all.
 *
 *   - **dom** — everything under `src/**\/*.test.{ts,tsx}`: `jsdom` because the behaviour under test
 *     is rendering (see `test/setup.ts` for the jsdom gaps this app hits and what they mean for what
 *     those tests can honestly prove).
 *   - **node** — `*.mirror.test.ts` only, in the plain Node environment with NO setup file. These
 *     tests import the SERVER's own modules to check that the wizard and the authoritative build
 *     agree, and the server's store reaches for `node:sqlite`, which vite refuses to bundle for a
 *     browser-shaped environment. `test/setup.ts` is skipped for the same reason it is needed
 *     elsewhere: it shims a DOM that this project deliberately does not have.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: ["./test/setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.mirror.test.ts"],
          restoreMocks: true,
          clearMocks: true
        }
      },
      {
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.mirror.test.ts"],
          restoreMocks: true,
          clearMocks: true
        }
      }
    ]
  }
});

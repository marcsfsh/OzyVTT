import { defineConfig } from "@playwright/test";

/**
 * The browser smoke suite. Each viewport gets its own server and fresh data directory, and its
 * journeys run in order in one worker, so the two viewports run side by side without sharing state.
 * `npm run build` first: the servers serve the built client.
 */
const basePort = Number(process.env.SMOKE_PORT ?? 3201);
const viewports = [
  { name: "phone", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
  { name: "laptop", use: { viewport: { width: 1280, height: 800 } } }
];

export default defineConfig({
  testDir: ".",
  outputDir: "test-results",
  fullyParallel: false,
  workers: viewports.length,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { browserName: "chromium", trace: "retain-on-failure" },
  projects: viewports.map((viewport, index) => ({
    name: viewport.name,
    use: { ...viewport.use, baseURL: `http://localhost:${basePort + index}` }
  })),
  webServer: viewports.map((_, index) => ({
    command: "node --import tsx e2e/start-server.mts",
    cwd: "..",
    env: { PORT: String(basePort + index) },
    url: `http://localhost:${basePort + index}/api/bootstrap/status`,
    // Never run against a server that already holds data.
    reuseExistingServer: false,
    // SIGTERM rather than the default kill, so the server removes its data directory.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 }
  }))
});

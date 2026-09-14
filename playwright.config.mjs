import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  // The hosted runner intermittently kills the browser process mid-run, which
  // surfaces as "browser.newContext: Target page, context or browser has been
  // closed" on an arbitrary test. Retrying relaunches the browser and clears it.
  // Local runs keep retries off so real failures stay obvious.
  retries: process.env.CI ? 2 : 0,
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "webkit", use: { browserName: "webkit" } }],
  use: {
    // Network fixtures must not be bypassed by the PWA service worker.
    serviceWorkers: "block",
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve-static.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
  },
});

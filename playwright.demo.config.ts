import { defineConfig, devices } from "@playwright/test";

// Builds the local demo (see tests/demo/seed.spec.ts). Run with `pnpm demo`, never with the tests.
// Uses the real date: no test clock.
export default defineConfig({
  testDir: "tests/demo",
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:3000", ...devices["Desktop Chrome"] },
  webServer: { command: "pnpm dev", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 120_000 },
});

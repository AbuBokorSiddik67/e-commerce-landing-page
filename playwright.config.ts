import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3000", trace: "on-first-retry" },
  webServer: {
    command: "npm run build && npm start",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});

import { defineConfig, devices } from "@playwright/test";

// These older browser tests create orders and delete test products. They do not
// verify database identity: require a deliberate disposable-only opt-in.
if (process.env.LANDIQ_E2E_DISPOSABLE !== "1") {
  throw new Error("Refusing E2E: set LANDIQ_E2E_DISPOSABLE=1 only with a dedicated disposable database and test credentials");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3000", trace: "on-first-retry" },
  webServer: {
    command: "npm run build && npm start",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

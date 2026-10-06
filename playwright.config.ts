import { defineConfig, devices } from "@playwright/test";

// Browser tests run against the built Worker (`npm run test:e2e` builds
// first); e2e/fixtures.ts starts it in workerd with a fresh local D1.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  use: {
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // The app is used on phones: one Android-shaped and one iPhone-shaped run.
  projects: [
    { name: "android", use: { ...devices["Pixel 7"] } },
    { name: "iphone", use: { ...devices["iPhone 15"] } },
  ],
});

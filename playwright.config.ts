import { defineConfig } from "@playwright/test";

// Browser tests for the matching board. They drive the real app in Google Chrome against a RUNNING server (npm run start in /server,
// then npm run build here), and create their own throw-away organisation each run.
export default defineConfig({
  testDir: "./e2e",
  testIgnore: "visual.spec.ts",   // the pixel capture has its own settings: playwright.visual.config.ts
  globalSetup: "./e2e/global-setup.ts",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:8787", channel: "chrome", trace: "retain-on-failure", storageState: "e2e/.auth.json" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1600, height: 1000 } } },
    { name: "narrow", use: { viewport: { width: 900, height: 1100 } } },
  ],
});

import { defineConfig } from "@playwright/test";

// The checks against a running service, by its real address, through a real browser: E2E_BASE=https://... npx playwright test -c playwright.hosted.config.ts
// Every account is made for the run, with invented documents, and all mail goes to the test mailbox (e2e/hosted/kit.ts). A failed check is not retried: it either passes or it is looked at.
// Traces and screenshots can show document contents and sessions, so they stay outside the repository in a private folder and are kept only on failure.
export default defineConfig({
  testDir: "./e2e/hosted",
  globalSetup: "./e2e/hosted/guard.ts",
  timeout: 600_000,     // reading a scan on the free server takes minutes; each step below has its own, shorter limit
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: `${process.env.HOME}/.rolematch/e2e-results`,
  reporter: [["list"], ["json", { outputFile: `${process.env.HOME}/.rolematch/e2e-results/report.json` }]],
  use: { actionTimeout: 30_000, baseURL: process.env.E2E_BASE, channel: "chrome", trace: "retain-on-failure", screenshot: "only-on-failure", viewport: { width: 1600, height: 1000 } },
});

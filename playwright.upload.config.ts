import { defineConfig } from "@playwright/test";

// The upload journey through the real file picker, in Google Chrome. Started by server/test/candidate/uploadJourney.test.ts, which owns the throw-away server.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "upload-journey.spec.ts",
  timeout: 600_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:8840", channel: "chrome", viewport: { width: 1600, height: 1000 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
});

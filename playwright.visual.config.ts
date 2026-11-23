import { defineConfig } from "@playwright/test";

// Pixel capture for the Chakra UI 3 migration (e2e/visual.spec.ts). Recording needs the running server and a signed-in seed organisation
// (the usual global setup); replaying needs only the built website served by the server, because every server answer comes from the recording.
// VISUAL_REUSE_AUTH=1 re-records with the sign-in saved by the last recording (sign-up is rate-limited, and a re-recorded state should
// show the same organisation as the rest of the baseline).
const record = !!process.env.VISUAL_RECORD, reuse = !!process.env.VISUAL_REUSE_AUTH;
export default defineConfig({
  testDir: "./e2e",
  testMatch: "visual.spec.ts",
  ...(record && !reuse ? { globalSetup: "./e2e/global-setup.ts" } : {}),
  snapshotPathTemplate: "e2e/visual-data/baseline/{arg}{ext}",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  updateSnapshots: record ? "all" : "none",
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:8787", channel: "chrome", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...(record ? { storageState: "e2e/.auth.json" } : {}) },
});

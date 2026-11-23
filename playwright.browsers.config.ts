import { defineConfig, devices } from "@playwright/test";

// The same screens in every browser engine, at desktop and phone size, in light and dark (owner, 9 Nov 2026: "I need this system to be properly tested";
// "it needs to be perfect in all browsers"). Chromium is Chrome and Edge; WebKit is Safari's engine (macOS build, the closest to Safari there is short of
// the iOS Simulator); Firefox is Firefox. Runs on the Mac against a RUNNING server, like playwright.config.ts, with the same throw-away organisation.
//   npx playwright test -c playwright.browsers.config.ts                    every engine, size and mode (12 runs of each test)
//   ENGINES=webkit SIZES=phone npx playwright test -c playwright.browsers.config.ts   a slice of them
const ENGINES = (process.env.ENGINES ?? "chromium,webkit,firefox").split(",");
const SIZES = (process.env.SIZES ?? "desktop,phone").split(",");
const MODES = (process.env.MODES ?? "light,dark").split(",") as ("light" | "dark")[];
const size = {
  desktop: { viewport: { width: 1440, height: 900 } },
  // An iPhone's width. Firefox has no phone mode, so it gets the size alone.
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true },
};
const engine = { chromium: { ...devices["Desktop Chrome"], channel: "chrome" }, webkit: devices["Desktop Safari"], firefox: devices["Desktop Firefox"] };

export default defineConfig({
  testDir: "./e2e",
  testMatch: "browsers.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/browsers-report" }]],
  outputDir: "e2e/browsers-results",
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:8787", trace: "retain-on-failure", screenshot: "only-on-failure", storageState: "e2e/.auth.json" },
  projects: ENGINES.flatMap((e) => SIZES.flatMap((s) => MODES.map((m) => ({
    name: `${e}-${s}-${m}`,
    use: { ...engine[e as keyof typeof engine], ...size[s as keyof typeof size], ...(s === "phone" && e !== "firefox" ? { isMobile: true } : {}), colorScheme: m },
  })))),
});

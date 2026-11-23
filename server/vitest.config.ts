import { defineConfig } from "vitest/config";

// Test files share one real database project and fixed ports, so they run one after another.
export default defineConfig({
  test: { globalSetup: ["test/globalSetup.ts"], include: ["test/**/*.test.ts"], fileParallelism: false, testTimeout: 90_000, hookTimeout: 180_000 },
});

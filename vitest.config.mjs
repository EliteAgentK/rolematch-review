import { defineConfig } from "vitest/config";
import path from "node:path";

// Fast unit tests for pure front-end logic. Browser behaviour is covered by Playwright (npm run test:e2e).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});

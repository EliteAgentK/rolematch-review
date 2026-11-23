import { defineConfig } from "vitest/config";
// Measurement runs only: the normal suite never picks these up.
export default defineConfig({ test: { include: ["test/perf/*.perf.ts"], fileParallelism: false, testTimeout: 1_800_000, hookTimeout: 300_000, globalSetup: ["test/globalSetup.ts"] } });

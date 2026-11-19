import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Config for the AI Strategy smoke ONLY (tests/smoke). The normal `npm test` (vitest.config.ts) includes just
 * tests/unit, so this REAL provider call can never run in CI, on a push or on a pull request. It is started only by
 * .github/workflows/qa-ai-strategy-smoke.yml (workflow_dispatch from main, protected Environment).
 * retry is 0 on purpose: a failed paid call must never be repeated automatically.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/smoke/**/*.smoke.test.ts"],
    testTimeout: 90_000,
    retry: 0,
    bail: 1,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/unit/stubs/server-only.ts"),
    },
  },
});

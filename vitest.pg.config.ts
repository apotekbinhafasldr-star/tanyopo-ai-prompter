import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * PostgreSQL concurrency tests (PR #38). Run only by the dedicated CI job
 * "pg-concurrency" (and locally with LINOE_PG_TEST=1 against a throw-away
 * database). The normal `npm run test` uses vitest.config.ts, which only
 * includes tests/unit, so these never run there.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/pg/**/*.test.ts"],
    globalSetup: ["./tests/integration/pg/global-setup.ts"],
    // One shared database: files must not interleave.
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});

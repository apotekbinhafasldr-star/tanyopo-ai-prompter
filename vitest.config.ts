import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/unit/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // See tests/unit/stubs/server-only.ts — the real package throws
      // outside Next's "react-server" bundler condition.
      "server-only": path.resolve(__dirname, "tests/unit/stubs/server-only.ts"),
    },
  },
});

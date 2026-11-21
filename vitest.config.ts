import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    globalSetup: ["src/tests/global-setup.ts"],
    testTimeout: 60_000,
    env: {
      DATABASE_URL: "file:./db/test-invariants.db",
    },
  },
});

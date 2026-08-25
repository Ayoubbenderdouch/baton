import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts", "src/adapters/**/*.ts"],
      exclude: ["**/*.test.ts", "src/test-utils/**"],
      reporter: ["text", "lcov"],
      thresholds: {
        // TESTING.md coverage gate
        "src/core/**/*.ts": { lines: 85 },
        "src/adapters/**/*.ts": { lines: 85 },
      },
    },
  },
});

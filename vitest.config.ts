import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "scripts/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "spike/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.{idea,git,cache,output,temp}/**",
      "legacy/**",
    ],
    environment: "node",
    globals: true,
    pool: "threads",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      exclude: [
        "coverage/**",
        "dist/**",
        "**/node_modules/**",
        "**/*.d.ts",
        "**/*.config.*",
        "legacy/**",
      ],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});

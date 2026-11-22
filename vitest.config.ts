import { defineConfig } from "vitest/config";

/** Root config for `npx vitest run` from the monorepo root. Packages use their own vitest.config.ts. */
export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/web/**/*.test.ts",
    ],
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside the react-server condition; tests import server modules directly.
      "server-only": fileURLToPath(new URL("./scripts/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node", // editor tests opt in with `// @vitest-environment happy-dom`
    // The tests inside each file run in a random order, so a test that needs another to run first fails at
    // once. Files stay in vitest's order (slowest first): each runs in an isolated worker, so their order
    // can't matter. A failing run prints its seed; replay it with `npx vitest run --sequence.seed=<seed>`.
    sequence: { shuffle: { files: false, tests: true } },
    reporters: ["default", "./scripts/seed-reporter.ts"],
  },
});

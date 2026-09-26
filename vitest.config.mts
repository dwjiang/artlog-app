import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./convex/test.setup.ts", "./convex/r2.test.setup.ts"],
    include: ["convex/**/*.test.ts"],
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test", "@convex-dev/rate-limiter"] } },
  },
});

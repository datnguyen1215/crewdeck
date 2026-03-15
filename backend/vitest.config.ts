import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["tests/integration/**"],
    setupFiles: ["./tests/setup.ts"],
    globals: true,
  },
});

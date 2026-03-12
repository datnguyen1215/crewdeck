import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Isolate modules between tests to avoid env var pollution
    isolate: true,
  },
});
